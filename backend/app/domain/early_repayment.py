"""
Simulador de Amortización Anticipada (Puntual o Periódica) para Valuriq.

Compara rigurosamente en aritmética `Decimal`:
- Estrategia 1: REDUCE_PAYMENT (Reducir cuota mensual manteniendo el plazo).
- Estrategia 2: REDUCE_TERM (Reducir plazo manteniendo la cuota mensual).
Contempla comisiones por amortización anticipada (%) y cambios de tramo en hipotecas mixtas.
"""

from decimal import Decimal

from app.domain.amortization import (
    calculate_french_monthly_payment,
    generate_amortization_schedule,
    resolve_effective_tins,
)
from app.domain.models import (
    EarlyRepaymentComparisonResult,
    EarlyRepaymentConfig,
    EarlyRepaymentFrequency,
    EarlyRepaymentRow,
    EarlyRepaymentStrategy,
    EarlyRepaymentStrategyResult,
    MortgageOfferInput,
    MortgageType,
    YearlyBalancePoint,
)
from app.domain.money import (
    HUNDRED,
    MONTHS_PER_YEAR,
    TWELVE,
    ZERO,
    annual_pct_to_monthly_rate,
    round_currency,
    round_rate,
)
from app.domain.optimizer import format_eur_es


def _estimate_effective_remaining_months(
    balance: Decimal,
    scheduled_payment: Decimal,
    annual_tin_pct: Decimal,
    max_months: int,
) -> int:
    """
    Calcula el número exacto de meses efectivos restantes para amortizar `balance`
    manteniendo `scheduled_payment` al tipo `annual_tin_pct` (acotado a `1..max_months`).
    Evita que en un cambio de tramo mixto/variable la estrategia `REDUCE_TERM`
    pierda los meses ya recortados por amortizaciones anticipadas previas.
    """
    if balance <= ZERO or max_months <= 1:
        return 1
    monthly_rate = annual_pct_to_monthly_rate(annual_tin_pct)
    sim_balance = balance
    months_count = 0
    for _ in range(max_months):
        months_count += 1
        interest = round_currency(sim_balance * monthly_rate)
        principal = round_currency(scheduled_payment - interest)
        if principal <= ZERO:
            return max_months
        if principal >= sim_balance:
            break
        sim_balance = round_currency(sim_balance - principal)
    return max(1, min(max_months, months_count))


def _is_repayment_month(month: int, config: EarlyRepaymentConfig) -> bool:
    """Determina si en el mes `month` (1..N) corresponde realizar una amortización anticipada."""
    if month < config.start_month:
        return False
    if config.end_month is not None and month > config.end_month:
        return False

    if config.frequency == EarlyRepaymentFrequency.ONE_OFF:
        return month == config.start_month
    if config.frequency == EarlyRepaymentFrequency.MONTHLY:
        return True
    if config.frequency == EarlyRepaymentFrequency.ANNUAL:
        return (month - config.start_month) % MONTHS_PER_YEAR == 0
    return False


def simulate_early_repayment_strategy(
    offer: MortgageOfferInput,
    config: EarlyRepaymentConfig,
    strategy: EarlyRepaymentStrategy,
    accepted_product_ids: set[str] | frozenset[str] | None = None,
    baseline_total_interest_eur: Decimal | None = None,
) -> EarlyRepaymentStrategyResult:
    """
    Simula mes a mes la evolución del préstamo bajo una estrategia de amortización
    anticipada (`REDUCE_PAYMENT` o `REDUCE_TERM`).
    """
    if accepted_product_ids is None:
        accepted_set: frozenset[str] = frozenset(p.id for p in offer.linked_products)
    else:
        accepted_set = frozenset(accepted_product_ids)

    if baseline_total_interest_eur is None:
        baseline_sched = generate_amortization_schedule(offer, accepted_set)
        baseline_interest = baseline_sched.total_interest_eur
    else:
        baseline_interest = baseline_total_interest_eur

    total_bonus_pct = ZERO
    for prod in offer.linked_products:
        if prod.id in accepted_set:
            total_bonus_pct = round_rate(total_bonus_pct + prod.bonus_pct)

    eff_initial_tin, eff_variable_tin = resolve_effective_tins(offer, total_bonus_pct)

    term_months = offer.term_months
    has_tranche_switch = (
        offer.mortgage_type in (MortgageType.MIXED, MortgageType.VARIABLE)
        and 0 < offer.fixed_years * MONTHS_PER_YEAR < term_months
    )
    switch_month = offer.fixed_years * MONTHS_PER_YEAR + 1 if has_tranche_switch else term_months + 1

    balance = offer.principal_eur
    current_tin = eff_initial_tin
    current_scheduled_payment = calculate_french_monthly_payment(balance, current_tin, term_months)
    initial_monthly_payment = current_scheduled_payment
    payment_after_first_repayment: Decimal | None = None

    schedule: list[EarlyRepaymentRow] = []
    total_interest_paid = ZERO
    total_early_repaid = ZERO
    total_commission_paid = ZERO

    for month in range(1, term_months + 1):
        if balance <= ZERO:
            break

        if month == switch_month:
            old_tin = current_tin
            current_tin = eff_variable_tin
            remaining_contract_months = term_months - month + 1
            if strategy == EarlyRepaymentStrategy.REDUCE_PAYMENT or total_early_repaid == ZERO:
                current_scheduled_payment = calculate_french_monthly_payment(
                    balance, current_tin, remaining_contract_months
                )
            elif current_tin != old_tin:
                # En REDUCE_TERM con amortizaciones previas y cambio de tipo mixto/variable,
                # estimar primero el plazo efectivo restante al tipo anterior y recalcular la
                # nueva cuota manteniendo ese plazo reducido para no degradar REDUCE_TERM en REDUCE_PAYMENT.
                effective_remaining_months = _estimate_effective_remaining_months(
                    balance=balance,
                    scheduled_payment=current_scheduled_payment,
                    annual_tin_pct=old_tin,
                    max_months=remaining_contract_months,
                )
                current_scheduled_payment = calculate_french_monthly_payment(
                    balance, current_tin, effective_remaining_months
                )

        monthly_rate = annual_pct_to_monthly_rate(current_tin)
        interest_eur = round_currency(balance * monthly_rate)

        if month == term_months or round_currency(current_scheduled_payment - interest_eur) >= balance:
            regular_principal_eur = balance
            regular_payment_eur = round_currency(interest_eur + regular_principal_eur)
            balance = ZERO
        else:
            regular_payment_eur = current_scheduled_payment
            regular_principal_eur = round_currency(regular_payment_eur - interest_eur)
            balance = round_currency(balance - regular_principal_eur)

        early_repayment_eur = ZERO
        commission_eur = ZERO

        if balance > ZERO and _is_repayment_month(month, config):
            early_repayment_eur = min(config.amount_eur, balance)
            commission_eur = round_currency(
                early_repayment_eur * (config.commission_pct / HUNDRED)
            )
            balance = round_currency(balance - early_repayment_eur)

            if strategy == EarlyRepaymentStrategy.REDUCE_PAYMENT and balance > ZERO and month < term_months:
                remaining_months = term_months - month
                current_scheduled_payment = calculate_french_monthly_payment(
                    balance, current_tin, remaining_months
                )

            if payment_after_first_repayment is None:
                payment_after_first_repayment = current_scheduled_payment if balance > ZERO else ZERO

        total_interest_paid = round_currency(total_interest_paid + interest_eur)
        total_early_repaid = round_currency(total_early_repaid + early_repayment_eur)
        total_commission_paid = round_currency(total_commission_paid + commission_eur)

        total_outflow = round_currency(regular_payment_eur + early_repayment_eur + commission_eur)
        year_num = (month - 1) // MONTHS_PER_YEAR + 1

        schedule.append(
            EarlyRepaymentRow(
                month=month,
                year=year_num,
                applied_tin_pct=current_tin,
                regular_payment_eur=regular_payment_eur,
                interest_eur=interest_eur,
                regular_principal_eur=regular_principal_eur,
                early_repayment_eur=early_repayment_eur,
                commission_eur=commission_eur,
                total_month_outflow_eur=total_outflow,
                remaining_balance_eur=balance,
            )
        )

    if payment_after_first_repayment is None:
        payment_after_first_repayment = initial_monthly_payment

    new_term_months = len(schedule)
    months_saved = max(0, term_months - new_term_months)
    years_saved = round_currency(Decimal(months_saved) / TWELVE)

    # En REDUCE_PAYMENT la última cuota regular representativa es la cuota recalculada vigente
    final_regular_payment = current_scheduled_payment

    gross_saved = round_currency(baseline_interest - total_interest_paid)
    net_savings = round_currency(gross_saved - total_commission_paid)

    # Construir curva anual sobre todos los años originales del préstamo para comparativa visual
    total_original_years = (term_months + MONTHS_PER_YEAR - 1) // MONTHS_PER_YEAR
    yearly_curve: list[YearlyBalancePoint] = []
    cum_interest = ZERO
    cum_early = ZERO

    for year in range(1, total_original_years + 1):
        start_m = (year - 1) * MONTHS_PER_YEAR + 1
        end_m = year * MONTHS_PER_YEAR
        year_rows = [r for r in schedule if start_m <= r.month <= end_m]
        if year_rows:
            for r in year_rows:
                cum_interest = round_currency(cum_interest + r.interest_eur)
                cum_early = round_currency(cum_early + r.early_repayment_eur)
            rem_bal = year_rows[-1].remaining_balance_eur
        else:
            rem_bal = ZERO

        yearly_curve.append(
            YearlyBalancePoint(
                year=year,
                remaining_balance_eur=rem_bal,
                cumulative_interest_eur=cum_interest,
                cumulative_early_repaid_eur=cum_early,
            )
        )

    return EarlyRepaymentStrategyResult(
        strategy=strategy,
        original_term_months=term_months,
        new_term_months=new_term_months,
        months_saved=months_saved,
        years_saved=years_saved,
        initial_monthly_payment_eur=initial_monthly_payment,
        monthly_payment_after_first_repayment_eur=payment_after_first_repayment,
        final_regular_monthly_payment_eur=final_regular_payment,
        total_early_repaid_eur=total_early_repaid,
        total_commission_paid_eur=total_commission_paid,
        baseline_total_interest_eur=baseline_interest,
        total_interest_paid_eur=total_interest_paid,
        gross_interest_saved_eur=gross_saved,
        net_savings_eur=net_savings,
        yearly_curve=yearly_curve,
        schedule=schedule,
    )


def compare_early_repayment_strategies(
    offer: MortgageOfferInput,
    config: EarlyRepaymentConfig,
    accepted_product_ids: set[str] | frozenset[str] | None = None,
) -> EarlyRepaymentComparisonResult:
    """
    Ejecuta y compara lado a lado las estrategias de Reducir Cuota vs Reducir Plazo
    para una configuración de amortización anticipada.
    """
    if accepted_product_ids is None:
        accepted_set: frozenset[str] = frozenset(p.id for p in offer.linked_products)
    else:
        accepted_set = frozenset(accepted_product_ids)

    baseline_sched = generate_amortization_schedule(offer, accepted_set)
    baseline_interest = baseline_sched.total_interest_eur
    baseline_initial_payment = baseline_sched.initial_monthly_payment_eur

    res_payment = simulate_early_repayment_strategy(
        offer=offer,
        config=config,
        strategy=EarlyRepaymentStrategy.REDUCE_PAYMENT,
        accepted_product_ids=accepted_set,
        baseline_total_interest_eur=baseline_interest,
    )
    res_term = simulate_early_repayment_strategy(
        offer=offer,
        config=config,
        strategy=EarlyRepaymentStrategy.REDUCE_TERM,
        accepted_product_ids=accepted_set,
        baseline_total_interest_eur=baseline_interest,
    )

    extra_savings_term = round_currency(res_term.net_savings_eur - res_payment.net_savings_eur)
    recommended = (
        EarlyRepaymentStrategy.REDUCE_TERM
        if res_term.net_savings_eur >= res_payment.net_savings_eur
        else EarlyRepaymentStrategy.REDUCE_PAYMENT
    )

    verdict_summary = (
        f"Reducir Plazo ahorra {format_eur_es(res_term.net_savings_eur)} netos en intereses "
        f"({format_eur_es(extra_savings_term)} más que Reducir Cuota) y recorta la hipoteca en "
        f"{res_term.months_saved} meses ({res_term.years_saved:.2f} años). "
        f"Reducir Cuota baja la letra mensual de {format_eur_es(res_payment.initial_monthly_payment_eur)} a "
        f"{format_eur_es(res_payment.monthly_payment_after_first_repayment_eur)} tras la primera amortización, "
        f"con un ahorro neto de {format_eur_es(res_payment.net_savings_eur)}."
    )

    return EarlyRepaymentComparisonResult(
        config=config,
        principal_eur=offer.principal_eur,
        baseline_term_months=offer.term_months,
        baseline_initial_payment_eur=baseline_initial_payment,
        baseline_total_interest_eur=baseline_interest,
        reduce_payment=res_payment,
        reduce_term=res_term,
        recommended_strategy=recommended,
        extra_savings_reducing_term_eur=extra_savings_term,
        verdict_summary=verdict_summary,
    )
