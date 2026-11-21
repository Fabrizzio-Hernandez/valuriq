"""
Motor de Amortización Francés para el mercado hipotecario español.

Soporta:
- Hipoteca Fija (FIXED)
- Hipoteca Variable (VARIABLE: Euríbor + diferencial)
- Hipoteca Mixta (MIXED: tramo fijo inicial X años + tramo variable Euríbor + diferencial)
- Prima Única Financiada (PUF_FINANCED): suma la prima única al capital en t=0 y calcula
  los intereses compuestos extra (`puf_extra_interest_eur`) generados por financiar el seguro.
- Ajuste exacto de céntimos residuales en la última cuota (saldo final = 0.00 € exacto).
- Proyección mensual y anualizada de productos vinculados con IPC e incremento por edad.
"""

from dataclasses import dataclass
from decimal import Decimal

from app.domain.models import (
    AmortizationRow,
    LinkedProduct,
    LinkedProductPaymentMode,
    MortgageOfferInput,
    MortgageType,
    YearlySummaryRow,
)
from app.domain.money import (
    HUNDRED,
    MONTHS_PER_YEAR,
    ONE,
    TWELVE,
    ZERO,
    annual_pct_to_monthly_rate,
    ensure_decimal,
    round_currency,
    round_rate,
)


@dataclass(frozen=True)
class BaseFrenchSchedule:
    """Cuadro francés base puro (dependiente solo de principal financiado y TIN efectivo)."""

    initial_monthly_payment_eur: Decimal
    variable_monthly_payment_eur: Decimal
    total_interest_eur: Decimal
    total_mortgage_payments_eur: Decimal
    monthly_tuples: list[tuple[Decimal, Decimal, Decimal, Decimal, Decimal]]


@dataclass(frozen=True)
class ScheduleComputationResult:
    """Resultado interno del motor de amortización para un escenario de vinculaciones."""

    financed_principal_eur: Decimal
    puf_financed_amount_eur: Decimal
    puf_extra_interest_eur: Decimal
    effective_initial_tin_pct: Decimal
    effective_variable_tin_pct: Decimal
    initial_monthly_payment_eur: Decimal
    variable_monthly_payment_eur: Decimal
    total_interest_eur: Decimal
    total_mortgage_payments_eur: Decimal
    total_linked_bank_cost_eur: Decimal
    total_linked_market_cost_eur: Decimal
    total_linked_cost_eur: Decimal
    total_linked_overcost_eur: Decimal
    monthly_schedule: list[AmortizationRow]
    yearly_summary: list[YearlySummaryRow]


def calculate_french_monthly_payment(
    principal_eur: Decimal,
    annual_tin_pct: Decimal,
    remaining_months: int,
) -> Decimal:
    """
    Calcula la cuota mensual constante del sistema de amortización francés:
        C = P * [ r * (1 + r)^n ] / [ (1 + r)^n - 1 ]
    donde r = TIN_anual / 100 / 12.

    Si TIN_anual == 0, C = P / n.
    Redondea a 2 decimales con ROUND_HALF_UP.
    """
    principal = ensure_decimal(principal_eur)
    tin_pct = ensure_decimal(annual_tin_pct)

    if remaining_months <= 0:
        raise ValueError("El número de meses restantes debe ser mayor que 0.")
    if principal < ZERO:
        raise ValueError("El capital pendiente no puede ser negativo.")
    if principal == ZERO:
        return ZERO

    if tin_pct == ZERO:
        return round_currency(principal / Decimal(remaining_months))

    monthly_rate = annual_pct_to_monthly_rate(tin_pct)
    compound_factor = (ONE + monthly_rate) ** remaining_months
    numerator = principal * monthly_rate * compound_factor
    denominator = compound_factor - ONE
    return round_currency(numerator / denominator)


def resolve_effective_tins(
    offer: MortgageOfferInput,
    total_bonus_pct: Decimal,
) -> tuple[Decimal, Decimal]:
    """
    Determina el (TIN efectivo inicial, TIN efectivo tramo variable) aplicando la bonificación
    total y respetando el suelo mínimo (`min_tin_floor_pct`).
    """
    bonus = ensure_decimal(total_bonus_pct)
    floor = offer.min_tin_floor_pct

    if offer.mortgage_type == MortgageType.FIXED:
        eff_fixed = max(floor, round_rate(offer.base_tin_pct - bonus))
        return eff_fixed, eff_fixed

    unbonified_variable = round_rate(offer.euribor_pct + offer.differential_pct)
    eff_variable = max(floor, round_rate(unbonified_variable - bonus))

    if offer.mortgage_type == MortgageType.MIXED:
        eff_initial = max(floor, round_rate(offer.base_tin_pct - bonus))
        return eff_initial, eff_variable

    # MortgageType.VARIABLE
    if offer.fixed_years > 0:
        eff_initial = max(floor, round_rate(offer.base_tin_pct - bonus))
        return eff_initial, eff_variable

    return eff_variable, eff_variable


def build_product_monthly_cost_vectors(
    product: LinkedProduct,
    term_months: int,
    estimated_ipc_pct: Decimal,
) -> tuple[list[Decimal], list[Decimal]]:
    """
    Genera dos vectores de longitud `term_months`:
    1. `bank_monthly_costs`: Coste mensual recurrente si se contrata con el banco en cada mes m=1..N.
    2. `market_monthly_costs`: Coste mensual si se contrata en el mercado libre en cada mes m=1..N.

    Aplica capitalización anual compuesta por IPC (`apply_ipc`) y/o edad (`annual_age_increase_pct`).
    En cada año completo de 12 meses, ajusta el mes 12 del año para que la suma de los 12 meses
    coincida al céntimo exacto con la prima anual correspondiente a ese año.
    """
    ipc_pct = ensure_decimal(estimated_ipc_pct) if product.apply_ipc else ZERO
    annual_growth_pct = ipc_pct + product.annual_age_increase_pct
    growth_ratio = annual_growth_pct / HUNDRED

    bank_costs: list[Decimal] = []
    market_costs: list[Decimal] = []

    total_years = (term_months + MONTHS_PER_YEAR - 1) // MONTHS_PER_YEAR

    for year_idx in range(total_years):
        growth_factor = (ONE + growth_ratio) ** year_idx
        annual_bank = round_currency(product.annual_bank_cost_eur * growth_factor)
        annual_market = round_currency(product.annual_market_cost_eur * growth_factor)

        months_in_this_year = min(MONTHS_PER_YEAR, term_months - year_idx * MONTHS_PER_YEAR)
        monthly_bank = round_currency(annual_bank / TWELVE)
        monthly_market = round_currency(annual_market / TWELVE)

        if months_in_this_year == MONTHS_PER_YEAR:
            for _ in range(MONTHS_PER_YEAR - 1):
                bank_costs.append(monthly_bank)
                market_costs.append(monthly_market)
            # Ajuste exacto en el mes 12 del año para que la suma anual sea exacta
            bank_costs.append(round_currency(annual_bank - monthly_bank * Decimal(11)))
            market_costs.append(round_currency(annual_market - monthly_market * Decimal(11)))
        else:
            for _ in range(months_in_this_year):
                bank_costs.append(monthly_bank)
                market_costs.append(monthly_market)

    return bank_costs, market_costs


def _compute_total_interest_for_principal(
    principal_eur: Decimal,
    term_months: int,
    eff_initial_tin: Decimal,
    eff_variable_tin: Decimal,
    switch_month: int,
) -> Decimal:
    """Calcula la suma exacta de intereses de un cuadro francés para un principal dado."""
    balance = principal_eur
    current_tin = eff_initial_tin
    current_scheduled_payment = calculate_french_monthly_payment(balance, current_tin, term_months)
    total_interest = ZERO

    for month in range(1, term_months + 1):
        if month == switch_month:
            current_tin = eff_variable_tin
            remaining_months = term_months - month + 1
            current_scheduled_payment = calculate_french_monthly_payment(
                balance, current_tin, remaining_months
            )

        monthly_rate = annual_pct_to_monthly_rate(current_tin)
        interest_eur = round_currency(balance * monthly_rate)

        if month < term_months:
            payment_eur = current_scheduled_payment
            principal_amort = round_currency(payment_eur - interest_eur)
            if principal_amort > balance:
                principal_amort = balance
            balance = round_currency(balance - principal_amort)
        else:
            balance = ZERO

        total_interest = round_currency(total_interest + interest_eur)

    return total_interest


def _build_base_french_schedule(
    financed_principal: Decimal,
    term_months: int,
    eff_initial_tin: Decimal,
    eff_variable_tin: Decimal,
    switch_month: int,
) -> BaseFrenchSchedule:
    """Construye el cuadro francés puro de principal e intereses para una clave de TIN y capital."""
    balance = financed_principal
    current_tin = eff_initial_tin
    current_scheduled_payment = calculate_french_monthly_payment(balance, current_tin, term_months)
    initial_monthly_payment = current_scheduled_payment
    variable_monthly_payment = current_scheduled_payment

    monthly_tuples: list[tuple[Decimal, Decimal, Decimal, Decimal, Decimal]] = []
    total_interest = ZERO
    total_mortgage_payments = ZERO

    for month in range(1, term_months + 1):
        if month == switch_month:
            current_tin = eff_variable_tin
            remaining_months = term_months - month + 1
            current_scheduled_payment = calculate_french_monthly_payment(
                balance, current_tin, remaining_months
            )
            variable_monthly_payment = current_scheduled_payment

        monthly_rate = annual_pct_to_monthly_rate(current_tin)
        interest_eur = round_currency(balance * monthly_rate)

        if month < term_months:
            payment_eur = current_scheduled_payment
            principal_eur = round_currency(payment_eur - interest_eur)
            if principal_eur > balance:
                principal_eur = balance
                payment_eur = round_currency(interest_eur + principal_eur)
            balance = round_currency(balance - principal_eur)
        else:
            principal_eur = balance
            payment_eur = round_currency(interest_eur + principal_eur)
            balance = ZERO

        total_interest = round_currency(total_interest + interest_eur)
        total_mortgage_payments = round_currency(total_mortgage_payments + payment_eur)
        monthly_tuples.append((current_tin, payment_eur, interest_eur, principal_eur, balance))

    return BaseFrenchSchedule(
        initial_monthly_payment_eur=initial_monthly_payment,
        variable_monthly_payment_eur=variable_monthly_payment,
        total_interest_eur=total_interest,
        total_mortgage_payments_eur=total_mortgage_payments,
        monthly_tuples=monthly_tuples,
    )


def generate_amortization_schedule(
    offer: MortgageOfferInput,
    accepted_product_ids: set[str] | frozenset[str],
    precomputed_product_vectors: dict[str, tuple[list[Decimal], list[Decimal]]] | None = None,
    french_schedule_cache: dict[tuple[Decimal, int, Decimal, Decimal, int], BaseFrenchSchedule] | None = None,
) -> ScheduleComputationResult:
    """
    Calcula el cuadro de amortización mensual completo y el resumen anual para una oferta
    y un subconjunto de vinculaciones aceptadas (incluyendo soporte para Prima Única Financiada PUF).
    Reutiliza `french_schedule_cache` cuando dos combinaciones comparten principal financiado y TIN efectivo.
    """
    term_months = offer.term_months

    # 1. Calcular bonificación total de las vinculaciones aceptadas
    total_bonus_pct = ZERO
    for prod in offer.linked_products:
        if prod.id in accepted_product_ids:
            total_bonus_pct = round_rate(total_bonus_pct + prod.bonus_pct)

    eff_initial_tin, eff_variable_tin = resolve_effective_tins(offer, total_bonus_pct)

    # 2. Preparar vectores mensuales de costes de productos vinculados y detectar PUF
    if precomputed_product_vectors is None:
        precomputed_product_vectors = {
            prod.id: build_product_monthly_cost_vectors(prod, term_months, offer.estimated_ipc_pct)
            for prod in offer.linked_products
        }

    monthly_bank_totals = [ZERO] * term_months
    monthly_market_totals = [ZERO] * term_months
    monthly_overcost_totals = [ZERO] * term_months
    puf_financed_amount = ZERO
    puf_upfront_overcost = ZERO

    for prod in offer.linked_products:
        bank_vec, market_vec = precomputed_product_vectors[prod.id]
        is_accepted = prod.id in accepted_product_ids

        if prod.payment_mode == LinkedProductPaymentMode.PUF_FINANCED:
            if is_accepted:
                # La Prima Única Financiada se suma al capital del préstamo en t=0
                puf_financed_amount = round_currency(puf_financed_amount + prod.puf_amount_eur)
                cov_months = min(term_months, prod.puf_coverage_years * MONTHS_PER_YEAR)
                market_during_cov = sum(market_vec[:cov_months], ZERO)
                puf_upfront_overcost = round_currency(
                    puf_upfront_overcost + (prod.puf_amount_eur - market_during_cov)
                )
                # Durante puf_coverage_years el coste recurrente es 0.00 €;
                # a partir del año puf_coverage_years + 1 aplica el coste de mercado libre
                for m_idx in range(cov_months, term_months):
                    monthly_market_totals[m_idx] = round_currency(
                        monthly_market_totals[m_idx] + market_vec[m_idx]
                    )
            else:
                # Si se rechaza la PUF del banco, se paga el seguro equivalente en mercado libre
                for m_idx in range(term_months):
                    monthly_market_totals[m_idx] = round_currency(
                        monthly_market_totals[m_idx] + market_vec[m_idx]
                    )
        else:
            # Modalidad ANNUAL estándar
            for m_idx in range(term_months):
                if is_accepted:
                    monthly_bank_totals[m_idx] = round_currency(monthly_bank_totals[m_idx] + bank_vec[m_idx])
                    monthly_overcost_totals[m_idx] = round_currency(
                        monthly_overcost_totals[m_idx] + (bank_vec[m_idx] - market_vec[m_idx])
                    )
                else:
                    monthly_market_totals[m_idx] = round_currency(
                        monthly_market_totals[m_idx] + market_vec[m_idx]
                    )

    # 3. Determinar mes de cambio de tramo para hipoteca MIXED (o VARIABLE con tramo fijo inicial)
    has_tranche_switch = (
        offer.mortgage_type in (MortgageType.MIXED, MortgageType.VARIABLE)
        and 0 < offer.fixed_years * MONTHS_PER_YEAR < term_months
    )
    switch_month = offer.fixed_years * MONTHS_PER_YEAR + 1 if has_tranche_switch else term_months + 1

    # 4. Obtener (o calcular y cachear) el cuadro francés base por (financed_principal, term_months, eff_initial_tin, eff_variable_tin, switch_month)
    financed_principal = round_currency(offer.principal_eur + puf_financed_amount)
    cache_key = (financed_principal, term_months, eff_initial_tin, eff_variable_tin, switch_month)
    if french_schedule_cache is not None and cache_key in french_schedule_cache:
        base_french = french_schedule_cache[cache_key]
    else:
        base_french = _build_base_french_schedule(
            financed_principal=financed_principal,
            term_months=term_months,
            eff_initial_tin=eff_initial_tin,
            eff_variable_tin=eff_variable_tin,
            switch_month=switch_month,
        )
        if french_schedule_cache is not None:
            french_schedule_cache[cache_key] = base_french

    initial_monthly_payment = base_french.initial_monthly_payment_eur
    variable_monthly_payment = base_french.variable_monthly_payment_eur
    total_interest = base_french.total_interest_eur
    total_mortgage_payments = base_french.total_mortgage_payments_eur

    monthly_rows: list[AmortizationRow] = []
    total_recurring_linked_bank = ZERO
    total_linked_market = ZERO
    total_recurring_overcost = ZERO

    for m_idx, (applied_tin, payment_eur, interest_eur, principal_eur, balance) in enumerate(
        base_french.monthly_tuples
    ):
        month = m_idx + 1
        l_bank = monthly_bank_totals[m_idx]
        l_market = monthly_market_totals[m_idx]
        l_total = round_currency(l_bank + l_market)
        l_overcost = monthly_overcost_totals[m_idx]
        total_outflow = round_currency(payment_eur + l_total)
        year_num = m_idx // MONTHS_PER_YEAR + 1

        total_recurring_linked_bank = round_currency(total_recurring_linked_bank + l_bank)
        total_linked_market = round_currency(total_linked_market + l_market)
        total_recurring_overcost = round_currency(total_recurring_overcost + l_overcost)

        monthly_rows.append(
            AmortizationRow(
                month=month,
                year=year_num,
                applied_tin_pct=applied_tin,
                monthly_payment_eur=payment_eur,
                interest_eur=interest_eur,
                principal_eur=principal_eur,
                remaining_balance_eur=balance,
                linked_bank_cost_eur=l_bank,
                linked_market_cost_eur=l_market,
                linked_total_cost_eur=l_total,
                linked_overcost_eur=l_overcost,
                total_monthly_outflow_eur=total_outflow,
            )
        )

    # 5. Calcular intereses extra generados exclusivamente por la PUF financiada (usando caché si está disponible)
    if puf_financed_amount > ZERO:
        no_puf_key = (offer.principal_eur, term_months, eff_initial_tin, eff_variable_tin, switch_month)
        if french_schedule_cache is not None and no_puf_key in french_schedule_cache:
            base_interest_no_puf = french_schedule_cache[no_puf_key].total_interest_eur
        else:
            no_puf_french = _build_base_french_schedule(
                financed_principal=offer.principal_eur,
                term_months=term_months,
                eff_initial_tin=eff_initial_tin,
                eff_variable_tin=eff_variable_tin,
                switch_month=switch_month,
            )
            if french_schedule_cache is not None:
                french_schedule_cache[no_puf_key] = no_puf_french
            base_interest_no_puf = no_puf_french.total_interest_eur
        puf_extra_interest = round_currency(total_interest - base_interest_no_puf)
    else:
        puf_extra_interest = ZERO

    # 6. Construir resumen anual y curvas acumuladas año a año
    yearly_summary: list[YearlySummaryRow] = []
    cum_mortgage = ZERO
    cum_interest = ZERO
    cum_linked = puf_financed_amount
    cum_overcost = puf_upfront_overcost
    cum_total = offer.total_initial_expenses_eur

    total_years = (term_months + MONTHS_PER_YEAR - 1) // MONTHS_PER_YEAR
    for year in range(1, total_years + 1):
        start_idx = (year - 1) * MONTHS_PER_YEAR
        end_idx = min(year * MONTHS_PER_YEAR, term_months)
        year_rows = monthly_rows[start_idx:end_idx]

        y_mortgage = sum((r.monthly_payment_eur for r in year_rows), ZERO)
        y_interest = sum((r.interest_eur for r in year_rows), ZERO)
        y_principal = sum((r.principal_eur for r in year_rows), ZERO)
        y_bank = sum((r.linked_bank_cost_eur for r in year_rows), ZERO)
        y_market = sum((r.linked_market_cost_eur for r in year_rows), ZERO)
        y_linked_total = round_currency(y_bank + y_market)
        y_overcost = sum((r.linked_overcost_eur for r in year_rows), ZERO)
        y_total_outflow = round_currency(y_mortgage + y_linked_total)

        cum_mortgage = round_currency(cum_mortgage + y_mortgage)
        cum_interest = round_currency(cum_interest + y_interest)
        cum_linked = round_currency(cum_linked + y_linked_total)
        cum_overcost = round_currency(cum_overcost + y_overcost)
        cum_total = round_currency(cum_total + y_total_outflow)

        yearly_summary.append(
            YearlySummaryRow(
                year=year,
                applied_tin_pct=year_rows[-1].applied_tin_pct,
                mortgage_payments_eur=y_mortgage,
                interest_paid_eur=y_interest,
                principal_paid_eur=y_principal,
                ending_balance_eur=year_rows[-1].remaining_balance_eur,
                linked_bank_cost_eur=y_bank,
                linked_market_cost_eur=y_market,
                linked_total_cost_eur=y_linked_total,
                linked_overcost_eur=y_overcost,
                annual_total_outflow_eur=y_total_outflow,
                cumulative_mortgage_outflow_eur=cum_mortgage,
                cumulative_interest_paid_eur=cum_interest,
                cumulative_linked_cost_eur=cum_linked,
                cumulative_linked_overcost_eur=cum_overcost,
                cumulative_total_outflow_eur=cum_total,
            )
        )

    # El coste total atribuido a productos vinculados en banco incluye las primas PUF financiadas
    total_linked_bank = round_currency(total_recurring_linked_bank + puf_financed_amount)
    total_linked_cost = round_currency(total_linked_bank + total_linked_market)
    total_linked_overcost = round_currency(total_recurring_overcost + puf_upfront_overcost)

    return ScheduleComputationResult(
        financed_principal_eur=financed_principal,
        puf_financed_amount_eur=puf_financed_amount,
        puf_extra_interest_eur=puf_extra_interest,
        effective_initial_tin_pct=eff_initial_tin,
        effective_variable_tin_pct=eff_variable_tin,
        initial_monthly_payment_eur=initial_monthly_payment,
        variable_monthly_payment_eur=variable_monthly_payment,
        total_interest_eur=total_interest,
        total_mortgage_payments_eur=total_mortgage_payments,
        total_linked_bank_cost_eur=total_linked_bank,
        total_linked_market_cost_eur=total_linked_market,
        total_linked_cost_eur=total_linked_cost,
        total_linked_overcost_eur=total_linked_overcost,
        monthly_schedule=monthly_rows,
        yearly_summary=yearly_summary,
    )
