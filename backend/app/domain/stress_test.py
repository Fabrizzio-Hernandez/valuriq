"""
Test de Estrés de Euríbor + Calculadora de Tasa de Esfuerzo (Umbral 35 % Banco de España)
para Valuriq.

Arquitectura Limpia:
- Pertenece a `/backend/app/domain/`.
- 100% aritmética `decimal.Decimal` (`ROUND_HALF_UP`), cero `float`, cero dependencias
  de FastAPI o SQLAlchemy.
"""

from decimal import Decimal
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field

from app.domain.amortization import (
    calculate_french_monthly_payment,
    generate_amortization_schedule,
)
from app.domain.models import MortgageOfferInput, MortgageType
from app.domain.money import (
    HUNDRED,
    MONTHS_PER_YEAR,
    ZERO,
    ensure_decimal,
    round_currency,
    round_rate,
    round_rate_2,
)
from app.domain.optimizer import format_eur_es, optimize_mortgage_offer

PRUDENT_EFFORT_THRESHOLD_PCT = Decimal("30.00")
BDE_MAX_EFFORT_THRESHOLD_PCT = Decimal("35.00")
DEFAULT_EURIBOR_STRESS_LEVELS = (
    Decimal("2.00"),
    Decimal("3.00"),
    Decimal("4.00"),
    Decimal("5.00"),
)


class EffortRiskLevel(str, Enum):
    """Clasificación semáforo de la tasa de esfuerzo según criterios del Banco de España."""

    HEALTHY = "HEALTHY"  # <= 30.00%
    TIGHT = "TIGHT"  # 30.01% - 35.00%
    RISK = "RISK"  # > 35.00%


class EuriborStressScenarioPoint(BaseModel):
    """Escenario de estrés para un nivel concreto de Euríbor (ej. 2%, 3%, 4%, 5%)."""

    model_config = ConfigDict(frozen=True)

    euribor_pct: Decimal = Field(..., description="Nivel de Euríbor simulado (%)")
    effective_tin_pct: Decimal = Field(..., description="TIN efectivo resultante en el tramo variable (%)")
    monthly_mortgage_payment_eur: Decimal = Field(..., description="Cuota mensual solo de hipoteca (€)")
    monthly_linked_cost_eur: Decimal = Field(..., description="Coste mensualizado de seguros/vinculaciones (€)")
    total_monthly_outflow_eur: Decimal = Field(..., description="Desembolso mensual total (cuota + seguros)")
    delta_vs_initial_outflow_eur: Decimal = Field(
        ...,
        description="Incremento o variación mensual respecto al desembolso inicial (€/mes)",
    )
    effort_ratio_pct: Decimal = Field(..., description="Tasa de esfuerzo resultante sobre ingresos netos (%)")
    risk_level: EffortRiskLevel
    exceeds_35_pct_limit: bool


class StressTestResult(BaseModel):
    """Resultado completo del Test de Estrés de Euríbor y Tasa de Esfuerzo (Banco de España 35%)."""

    model_config = ConfigDict(frozen=True)

    mortgage_type: MortgageType
    monthly_net_household_income_eur: Decimal
    initial_monthly_mortgage_payment_eur: Decimal
    initial_monthly_linked_cost_eur: Decimal
    initial_total_monthly_outflow_eur: Decimal
    initial_effort_ratio_pct: Decimal
    initial_risk_level: EffortRiskLevel
    max_prudent_monthly_outflow_30_pct_eur: Decimal
    max_recommended_monthly_outflow_35_pct_eur: Decimal
    is_fixed_rate_protected: bool
    variable_tranche_start_month: int
    variable_tranche_principal_balance_eur: Decimal
    critical_euribor_35_pct: Decimal | None = Field(
        default=None,
        description="Nivel de Euríbor (%) a partir del cual el desembolso mensual supera el 35% de los ingresos (None en Fija)",
    )
    scenarios: list[EuriborStressScenarioPoint]
    verdict_headline: str
    verdict_explanation: str


def classify_effort_risk(effort_ratio_pct: Decimal) -> EffortRiskLevel:
    """Clasifica una tasa de esfuerzo (%) según los umbrales del 30% y 35% del Banco de España."""
    if effort_ratio_pct <= PRUDENT_EFFORT_THRESHOLD_PCT:
        return EffortRiskLevel.HEALTHY
    if effort_ratio_pct <= BDE_MAX_EFFORT_THRESHOLD_PCT:
        return EffortRiskLevel.TIGHT
    return EffortRiskLevel.RISK


def _solve_critical_euribor_for_target_quota(
    balance_eur: Decimal,
    remaining_months: int,
    target_mortgage_quota_eur: Decimal,
    differential_pct: Decimal,
    total_bonus_pct: Decimal,
    min_tin_floor_pct: Decimal,
) -> Decimal | None:
    """
    Halla mediante bisección en `Decimal` el nivel de Euríbor (%) en el que la cuota
    hipotecaria alcanza `target_mortgage_quota_eur` (umbral del 35% de ingresos una vez
    descontado el coste mensual de seguros).
    """
    if balance_eur <= ZERO or remaining_months <= 0:
        return None

    min_possible_quota = calculate_french_monthly_payment(
        balance_eur, min_tin_floor_pct, remaining_months
    )
    if target_mortgage_quota_eur <= min_possible_quota:
        return Decimal("-5.00")

    low_tin = min_tin_floor_pct
    high_tin = Decimal("25.00")
    two = Decimal("2")

    for _ in range(60):
        mid_tin = (low_tin + high_tin) / two
        q = calculate_french_monthly_payment(balance_eur, mid_tin, remaining_months)
        if q < target_mortgage_quota_eur:
            low_tin = mid_tin
        else:
            high_tin = mid_tin

    critical_tin = (low_tin + high_tin) / two
    net_diff = differential_pct - total_bonus_pct
    critical_euribor = round_rate_2(critical_tin - net_diff)
    return critical_euribor


def run_euribor_stress_and_effort_test(
    offer: MortgageOfferInput,
    monthly_net_household_income_eur: Decimal,
    accepted_product_ids: set[str] | frozenset[str] | None = None,
) -> StressTestResult:
    """
    Ejecuta el cálculo de Tasa de Esfuerzo actual (regla del 35% del Banco de España)
    y simula 4 escenarios de estrés de Euríbor (2%, 3%, 4%, 5%).
    """
    income = round_currency(ensure_decimal(monthly_net_household_income_eur))
    if income <= ZERO:
        raise ValueError("Los ingresos netos mensuales del hogar deben ser mayores que 0 €.")

    if accepted_product_ids is None:
        audit = optimize_mortgage_offer(offer)
        accepted_set = frozenset(audit.scenario_c_optimal.accepted_product_ids)
    else:
        accepted_set = frozenset(accepted_product_ids)

    sched = generate_amortization_schedule(offer, accepted_set)
    first_row = sched.monthly_schedule[0]

    init_mortgage_payment = first_row.monthly_payment_eur
    init_linked_cost = first_row.linked_total_cost_eur
    init_total_outflow = first_row.total_monthly_outflow_eur

    init_effort_pct = round_rate_2((init_total_outflow / income) * HUNDRED)
    init_risk = classify_effort_risk(init_effort_pct)

    max_30_eur = round_currency(income * (PRUDENT_EFFORT_THRESHOLD_PCT / HUNDRED))
    max_35_eur = round_currency(income * (BDE_MAX_EFFORT_THRESHOLD_PCT / HUNDRED))

    total_bonus_pct = sum(
        (p.bonus_pct for p in offer.linked_products if p.id in accepted_set),
        ZERO,
    )
    total_bonus_pct = round_rate(total_bonus_pct)

    is_fixed = offer.mortgage_type == MortgageType.FIXED

    if is_fixed:
        var_start_month = 1
        var_balance = sched.financed_principal_eur
        var_remaining_months = offer.term_months
        var_linked_month_cost = init_linked_cost
    elif offer.mortgage_type == MortgageType.MIXED and 0 < offer.fixed_years * MONTHS_PER_YEAR < offer.term_months:
        var_start_month = offer.fixed_years * MONTHS_PER_YEAR + 1
        var_balance = sched.monthly_schedule[var_start_month - 2].remaining_balance_eur
        var_remaining_months = offer.term_months - var_start_month + 1
        var_linked_month_cost = sched.monthly_schedule[var_start_month - 1].linked_total_cost_eur
    else:
        # VARIABLE desde el mes 1 (o con tramo inicial menor)
        if 0 < offer.fixed_years * MONTHS_PER_YEAR < offer.term_months:
            var_start_month = offer.fixed_years * MONTHS_PER_YEAR + 1
            var_balance = sched.monthly_schedule[var_start_month - 2].remaining_balance_eur
            var_remaining_months = offer.term_months - var_start_month + 1
            var_linked_month_cost = sched.monthly_schedule[var_start_month - 1].linked_total_cost_eur
        else:
            var_start_month = 1
            var_balance = sched.financed_principal_eur
            var_remaining_months = offer.term_months
            var_linked_month_cost = init_linked_cost

    scenarios: list[EuriborStressScenarioPoint] = []
    first_breach_euribor: Decimal | None = None

    for eur_level in DEFAULT_EURIBOR_STRESS_LEVELS:
        if is_fixed:
            eff_tin = sched.effective_initial_tin_pct
            m_payment = init_mortgage_payment
            m_linked = init_linked_cost
        else:
            raw_tin = round_rate(eur_level + offer.differential_pct - total_bonus_pct)
            eff_tin = max(offer.min_tin_floor_pct, raw_tin)
            m_payment = calculate_french_monthly_payment(
                var_balance, eff_tin, var_remaining_months
            )
            m_linked = var_linked_month_cost

        tot_outflow = round_currency(m_payment + m_linked)
        delta_outflow = round_currency(tot_outflow - init_total_outflow)
        eff_pct = round_rate_2((tot_outflow / income) * HUNDRED)
        r_level = classify_effort_risk(eff_pct)
        exceeds_35 = eff_pct > BDE_MAX_EFFORT_THRESHOLD_PCT

        if exceeds_35 and first_breach_euribor is None:
            first_breach_euribor = eur_level

        scenarios.append(
            EuriborStressScenarioPoint(
                euribor_pct=round_rate_2(eur_level),
                effective_tin_pct=round_rate_2(eff_tin),
                monthly_mortgage_payment_eur=m_payment,
                monthly_linked_cost_eur=m_linked,
                total_monthly_outflow_eur=tot_outflow,
                delta_vs_initial_outflow_eur=delta_outflow,
                effort_ratio_pct=eff_pct,
                risk_level=r_level,
                exceeds_35_pct_limit=exceeds_35,
            )
        )

    critical_euribor: Decimal | None = None
    if not is_fixed:
        target_quota_35 = round_currency(max_35_eur - var_linked_month_cost)
        critical_euribor = _solve_critical_euribor_for_target_quota(
            balance_eur=var_balance,
            remaining_months=var_remaining_months,
            target_mortgage_quota_eur=target_quota_35,
            differential_pct=offer.differential_pct,
            total_bonus_pct=total_bonus_pct,
            min_tin_floor_pct=offer.min_tin_floor_pct,
        )

    if init_risk == EffortRiskLevel.HEALTHY:
        status_label = "Saludable (<= 30%)"
    elif init_risk == EffortRiskLevel.TIGHT:
        status_label = "Ajustada (30% - 35%)"
    else:
        status_label = "Riesgo Alto (> 35% límite BdE)"

    verdict_headline = (
        f"Tasa de Esfuerzo Actual: {str(init_effort_pct).replace('.', ',')} % · {status_label}"
    )

    if is_fixed:
        verdict_explanation = (
            f"Con unos ingresos netos de {format_eur_es(income)}/mes, tu desembolso real "
            f"({format_eur_es(init_total_outflow)}/mes incluyendo seguros) absorbe el "
            f"{str(init_effort_pct).replace('.', ',')} % de tu renta (máximo recomendado BdE: "
            f"{format_eur_es(max_35_eur)}/mes). Al ser una hipoteca Fija, tu cuota está inmunizada "
            f"frente a futuras subidas del Euríbor."
        )
    else:
        crit_str = (
            f"{str(critical_euribor).replace('.', ',')} %"
            if critical_euribor is not None
            else "N/A"
        )
        verdict_explanation = (
            f"En el tramo variable (a partir del mes {var_start_month}, con saldo vivo de "
            f"{format_eur_es(var_balance)}), tu hipoteca superaría el umbral máximo del 35 % "
            f"del Banco de España ({format_eur_es(max_35_eur)}/mes) si el Euríbor alcanza el {crit_str}."
        )

    return StressTestResult(
        mortgage_type=offer.mortgage_type,
        monthly_net_household_income_eur=income,
        initial_monthly_mortgage_payment_eur=init_mortgage_payment,
        initial_monthly_linked_cost_eur=init_linked_cost,
        initial_total_monthly_outflow_eur=init_total_outflow,
        initial_effort_ratio_pct=init_effort_pct,
        initial_risk_level=init_risk,
        max_prudent_monthly_outflow_30_pct_eur=max_30_eur,
        max_recommended_monthly_outflow_35_pct_eur=max_35_eur,
        is_fixed_rate_protected=is_fixed,
        variable_tranche_start_month=var_start_month,
        variable_tranche_principal_balance_eur=var_balance,
        critical_euribor_35_pct=critical_euribor,
        scenarios=scenarios,
        verdict_headline=verdict_headline,
        verdict_explanation=verdict_explanation,
    )
