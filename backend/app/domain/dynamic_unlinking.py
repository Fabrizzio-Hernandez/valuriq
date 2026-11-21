"""
Motor de Desvinculación Dinámica por Años para Valuriq.

Determina en qué año exacto conviene cancelar cada producto vinculado de pago anual
(`ANNUAL`) cuando el saldo vivo de la hipoteca ha descendido lo suficiente como para
que la prima anual del banco supere el ahorro en intereses generado por su bonificación.

Arquitectura Limpia:
- Pertenece a `/backend/app/domain/`.
- 100% aritmética `decimal.Decimal` (`ROUND_HALF_UP`), cero `float`, cero dependencias
  de FastAPI o SQLAlchemy.
"""

from decimal import Decimal

from app.domain.amortization import (
    _compute_total_interest_for_principal,
    build_product_monthly_cost_vectors,
    calculate_french_monthly_payment,
    resolve_effective_tins,
)
from app.domain.irr import calculate_tae_pct
from app.domain.models import (
    DynamicUnlinkingStrategyResult,
    LinkedProduct,
    LinkedProductPaymentMode,
    MortgageAuditResult,
    MortgageOfferInput,
    MortgageType,
    ProductDynamicStrategy,
    ProductYearlyBenefitPoint,
)
from app.domain.money import (
    HUNDRED,
    MONTHS_PER_YEAR,
    ZERO,
    annual_pct_to_monthly_rate,
    round_currency,
    round_rate,
)
from app.domain.optimizer import format_eur_es, optimize_mortgage_offer


def simulate_dynamic_cutoff_schedule(
    offer: MortgageOfferInput,
    keep_years_by_product: dict[str, int],
    precomputed_vectors: dict[str, tuple[list[Decimal], list[Decimal]]],
) -> tuple[Decimal, list[Decimal], list[Decimal]]:
    """
    Simula mes a mes toda la vida de la hipoteca cuando cada producto vinculado `prod_id`
    se mantiene activo con el banco durante los años `1..keep_years_by_product[prod_id]`
    y se cancela al inicio del año `keep_years_by_product[prod_id] + 1`.

    Devuelve:
    - `total_cost_eur`: Desembolso total real (gastos iniciales + cuotas + seguros).
    - `monthly_outflows`: Lista de desembolsos mensuales reales (para cálculo de TAE Real).
    - `year_start_balances`: Saldo vivo al inicio de cada año `y = 1..Y`.
    """
    term_months = offer.term_months
    products = offer.linked_products

    # 1. Determinar principal financiado inicial (sumando PUF aceptadas en t=0)
    puf_financed_amount = ZERO
    for prod in products:
        if (
            prod.payment_mode == LinkedProductPaymentMode.PUF_FINANCED
            and keep_years_by_product.get(prod.id, 0) > 0
        ):
            puf_financed_amount = round_currency(puf_financed_amount + prod.puf_amount_eur)

    financed_principal = round_currency(offer.principal_eur + puf_financed_amount)
    balance = financed_principal

    has_tranche_switch = (
        offer.mortgage_type in (MortgageType.MIXED, MortgageType.VARIABLE)
        and 0 < offer.fixed_years * MONTHS_PER_YEAR < term_months
    )
    switch_month = offer.fixed_years * MONTHS_PER_YEAR + 1 if has_tranche_switch else term_months + 1

    current_tin = ZERO
    current_scheduled_payment = ZERO
    monthly_outflows: list[Decimal] = []
    year_start_balances: list[Decimal] = []
    total_outflows_sum = ZERO

    for month in range(1, term_months + 1):
        year_num = (month - 1) // MONTHS_PER_YEAR + 1
        is_start_of_year = (month - 1) % MONTHS_PER_YEAR == 0

        if is_start_of_year:
            year_start_balances.append(balance)

        # Recalcular TIN y cuota al inicio de cada año o en el mes de cambio de tramo mixto/variable
        if month == 1 or is_start_of_year or month == switch_month:
            active_bonus = ZERO
            for prod in products:
                keep_y = keep_years_by_product.get(prod.id, 0)
                if prod.payment_mode == LinkedProductPaymentMode.PUF_FINANCED:
                    if keep_y > 0:
                        active_bonus = round_rate(active_bonus + prod.bonus_pct)
                else:
                    if year_num <= keep_y:
                        active_bonus = round_rate(active_bonus + prod.bonus_pct)

            eff_init, eff_var = resolve_effective_tins(offer, active_bonus)
            new_tin = eff_var if month >= switch_month else eff_init

            if month == 1 or new_tin != current_tin or month == switch_month:
                current_tin = new_tin
                remaining_months = term_months - month + 1
                current_scheduled_payment = calculate_french_monthly_payment(
                    balance, current_tin, remaining_months
                )

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
            # Ajuste exacto de última cuota a saldo 0.00 €
            principal_eur = balance
            payment_eur = round_currency(interest_eur + principal_eur)
            balance = ZERO

        # Coste de seguros/productos en este mes m
        m_idx = month - 1
        month_linked_cost = ZERO
        for prod in products:
            bank_vec, market_vec = precomputed_vectors[prod.id]
            keep_y = keep_years_by_product.get(prod.id, 0)

            if prod.payment_mode == LinkedProductPaymentMode.PUF_FINANCED:
                if keep_y > 0:
                    if year_num > prod.puf_coverage_years:
                        month_linked_cost = round_currency(month_linked_cost + market_vec[m_idx])
                else:
                    month_linked_cost = round_currency(month_linked_cost + market_vec[m_idx])
            else:
                if year_num <= keep_y:
                    month_linked_cost = round_currency(month_linked_cost + bank_vec[m_idx])
                else:
                    month_linked_cost = round_currency(month_linked_cost + market_vec[m_idx])

        month_outflow = round_currency(payment_eur + month_linked_cost)
        monthly_outflows.append(month_outflow)
        total_outflows_sum = round_currency(total_outflows_sum + month_outflow)

    total_cost = round_currency(offer.total_initial_expenses_eur + total_outflows_sum)
    return total_cost, monthly_outflows, year_start_balances


def _build_product_yearly_breakdown(
    prod: LinkedProduct,
    keep_years: int,
    total_years: int,
    term_months: int,
    year_start_balances: list[Decimal],
    precomputed_vectors: dict[str, tuple[list[Decimal], list[Decimal]]],
) -> tuple[list[ProductYearlyBenefitPoint], int | None, Decimal]:
    """
    Construye la serie año a año de ahorro en intereses generado por la bonificación
    del producto frente al sobrecoste del seguro del banco, identificando el año de cruce.
    """
    bank_vec, market_vec = precomputed_vectors[prod.id]
    points: list[ProductYearlyBenefitPoint] = []
    crossover_year: int | None = None
    cumulative_net_benefit = ZERO
    bonus_ratio = prod.bonus_pct / HUNDRED

    for year in range(1, total_years + 1):
        start_m = (year - 1) * MONTHS_PER_YEAR
        end_m = min(year * MONTHS_PER_YEAR, term_months)
        bal_start = year_start_balances[year - 1] if year - 1 < len(year_start_balances) else ZERO
        bal_end = year_start_balances[year] if year < len(year_start_balances) else ZERO
        avg_year_balance = round_currency((bal_start + bal_end) / Decimal("2"))

        # Ahorro anual en intereses generado por rebajar `bonus_pct` sobre el saldo medio vivo del año
        months_factor = Decimal(end_m - start_m) / Decimal(MONTHS_PER_YEAR)
        interest_saved = round_currency(avg_year_balance * bonus_ratio * months_factor)

        if prod.payment_mode == LinkedProductPaymentMode.PUF_FINANCED:
            if year <= prod.puf_coverage_years:
                bank_cost = round_currency(prod.puf_amount_eur / Decimal(prod.puf_coverage_years))
                market_cost = sum(market_vec[start_m:end_m], ZERO)
            else:
                bank_cost = sum(market_vec[start_m:end_m], ZERO)
                market_cost = bank_cost
        else:
            bank_cost = sum(bank_vec[start_m:end_m], ZERO)
            market_cost = sum(market_vec[start_m:end_m], ZERO)

        overcost = round_currency(bank_cost - market_cost)
        net_benefit = round_currency(interest_saved - overcost)
        is_active = (keep_years > 0) if prod.payment_mode == LinkedProductPaymentMode.PUF_FINANCED else (year <= keep_years)

        if is_active:
            cumulative_net_benefit = round_currency(cumulative_net_benefit + net_benefit)

        if crossover_year is None and overcost > interest_saved:
            crossover_year = year

        points.append(
            ProductYearlyBenefitPoint(
                year=year,
                remaining_balance_start_eur=bal_start,
                interest_saved_by_bonus_eur=interest_saved,
                bank_cost_eur=bank_cost,
                market_cost_eur=market_cost,
                annual_overcost_eur=overcost,
                net_annual_benefit_eur=net_benefit,
                is_active_with_bank=is_active,
            )
        )

    return points, crossover_year, cumulative_net_benefit


def optimize_dynamic_unlinking_strategy(
    offer: MortgageOfferInput,
    static_audit: MortgageAuditResult | None = None,
) -> DynamicUnlinkingStrategyResult:
    """
    Calcula el plan temporal óptimo de desvinculación año a año para cada producto vinculado
    mediante descenso coordinado determinista sobre el cuadro de amortización francés exacto.
    """
    if static_audit is None:
        static_audit = optimize_mortgage_offer(offer)

    term_months = offer.term_months
    total_years = (term_months + MONTHS_PER_YEAR - 1) // MONTHS_PER_YEAR
    products = offer.linked_products

    precomputed_vectors = {
        prod.id: build_product_monthly_cost_vectors(prod, term_months, offer.estimated_ipc_pct)
        for prod in products
    }

    static_accepted = set(static_audit.scenario_c_optimal.accepted_product_ids)
    keep_years_map: dict[str, int] = {
        prod.id: (total_years if prod.id in static_accepted else 0)
        for prod in products
    }

    best_cost, best_outflows, best_balances = simulate_dynamic_cutoff_schedule(
        offer=offer,
        keep_years_by_product=keep_years_map,
        precomputed_vectors=precomputed_vectors,
    )

    # Precalcular sumas anuales de coste de banco y mercado por producto y año para acelerar la búsqueda
    annual_bank_by_prod: dict[str, list[Decimal]] = {}
    annual_market_by_prod: dict[str, list[Decimal]] = {}
    for prod in products:
        b_vec, m_vec = precomputed_vectors[prod.id]
        b_years: list[Decimal] = []
        m_years: list[Decimal] = []
        for y in range(1, total_years + 1):
            s_m = (y - 1) * MONTHS_PER_YEAR
            e_m = min(y * MONTHS_PER_YEAR, term_months)
            b_years.append(sum(b_vec[s_m:e_m], ZERO))
            m_years.append(sum(m_vec[s_m:e_m], ZERO))
        annual_bank_by_prod[prod.id] = b_years
        annual_market_by_prod[prod.id] = m_years

    # Descenso coordinado determinista por producto sobre años naturales y in {0..total_years}
    for _pass in range(2):
        improved_in_pass = False
        for prod in products:
            current_k = keep_years_map[prod.id]
            if prod.payment_mode == LinkedProductPaymentMode.PUF_FINANCED:
                candidates = [0, total_years]
            elif all(
                annual_bank_by_prod[prod.id][y_idx] <= annual_market_by_prod[prod.id][y_idx]
                for y_idx in range(total_years)
            ):
                # Si el producto nunca tiene sobrecoste frente al mercado (ej. nómina 0 €), solo evaluar 0 o todo el plazo
                candidates = [0, total_years]
            else:
                # Estimar año analítico de cruce (donde el sobrecoste anual supera el ahorro de intereses)
                # y acotar la búsqueda exacta a una ventana alrededor del cruce más los extremos {0, total_years}
                bonus_ratio = prod.bonus_pct / HUNDRED
                est_cross: int | None = None
                for y_idx in range(total_years):
                    bal_s = best_balances[y_idx] if y_idx < len(best_balances) else ZERO
                    bal_e = best_balances[y_idx + 1] if y_idx + 1 < len(best_balances) else ZERO
                    avg_b = (bal_s + bal_e) / Decimal("2")
                    approx_saved = avg_b * bonus_ratio
                    overcost_y = annual_bank_by_prod[prod.id][y_idx] - annual_market_by_prod[prod.id][y_idx]
                    if overcost_y > approx_saved:
                        est_cross = y_idx
                        break
                if est_cross is None:
                    candidates = [0, total_years]
                else:
                    win_low = max(0, est_cross - 3)
                    win_high = min(total_years, est_cross + 3)
                    candidates = sorted({0, total_years, *range(win_low, win_high + 1)})

            best_k_for_prod = current_k
            for candidate_k in candidates:
                if candidate_k == best_k_for_prod:
                    continue
                trial_map = dict(keep_years_map)
                trial_map[prod.id] = candidate_k
                trial_cost, trial_outflows, trial_balances = simulate_dynamic_cutoff_schedule(
                    offer=offer,
                    keep_years_by_product=trial_map,
                    precomputed_vectors=precomputed_vectors,
                )

                # Preferir estrictamente menor coste, o igual coste con menor número de años atado al banco
                if trial_cost < best_cost or (
                    trial_cost == best_cost and candidate_k < best_k_for_prod
                ):
                    best_cost = trial_cost
                    best_outflows = trial_outflows
                    best_balances = trial_balances
                    best_k_for_prod = candidate_k
                    improved_in_pass = True

            keep_years_map[prod.id] = best_k_for_prod

        if not improved_in_pass:
            break

    static_opt_cost = static_audit.scenario_c_optimal.total_cost_eur
    all_bonified_cost = static_audit.scenario_a_all_bonified.total_cost_eur

    extra_savings_vs_static = round_currency(static_opt_cost - best_cost)
    total_savings_vs_all = round_currency(all_bonified_cost - best_cost)
    dynamic_tae = calculate_tae_pct(offer.net_received_capital_eur, best_outflows)

    has_tranche_switch = (
        offer.mortgage_type in (MortgageType.MIXED, MortgageType.VARIABLE)
        and 0 < offer.fixed_years * MONTHS_PER_YEAR < term_months
    )
    switch_month = offer.fixed_years * MONTHS_PER_YEAR + 1 if has_tranche_switch else term_months + 1

    product_strategies: list[ProductDynamicStrategy] = []
    intermediate_cancellations: list[str] = []

    for prod in products:
        k_years = keep_years_map[prod.id]
        yearly_points, crossover_yr, cum_benefit = _build_product_yearly_breakdown(
            prod=prod,
            keep_years=k_years,
            total_years=total_years,
            term_months=term_months,
            year_start_balances=best_balances,
            precomputed_vectors=precomputed_vectors,
        )

        if k_years <= 0:
            cancel_at_year = None
            recommendation = "Rechazar desde el día 1"
        elif k_years >= total_years:
            cancel_at_year = None
            recommendation = "Mantener toda la hipoteca"
        else:
            cancel_at_year = k_years + 1
            recommendation = f"Aceptar años 1 a {k_years} y cancelar en el año {cancel_at_year}"
            intermediate_cancellations.append(f"{prod.name} (cancelar en Año {cancel_at_year})")

        # Si el producto es PUF_FINANCED, calcular intereses extra que genera financiar su prima única
        puf_extra_int = ZERO
        if prod.payment_mode == LinkedProductPaymentMode.PUF_FINANCED and prod.puf_amount_eur > ZERO:
            eff_init, eff_var = resolve_effective_tins(
                offer, static_audit.scenario_a_all_bonified.total_bonus_pct
            )
            int_with_puf = _compute_total_interest_for_principal(
                round_currency(offer.principal_eur + prod.puf_amount_eur),
                term_months,
                eff_init,
                eff_var,
                switch_month,
            )
            int_no_puf = _compute_total_interest_for_principal(
                offer.principal_eur,
                term_months,
                eff_init,
                eff_var,
                switch_month,
            )
            puf_extra_int = round_currency(int_with_puf - int_no_puf)

        product_strategies.append(
            ProductDynamicStrategy(
                product_id=prod.id,
                product_name=prod.name,
                payment_mode=prod.payment_mode,
                bonus_pct=prod.bonus_pct,
                keep_years=k_years,
                cancel_at_year=cancel_at_year,
                total_years=total_years,
                recommendation=recommendation,
                crossover_year=crossover_yr,
                cumulative_net_benefit_eur=cum_benefit,
                puf_extra_interest_eur=puf_extra_int,
                yearly_breakdown=yearly_points,
            )
        )

    if intermediate_cancellations:
        summary_headline = (
            f"Desvinculación Dinámica: {', '.join(intermediate_cancellations)} · "
            f"Ahorras +{format_eur_es(extra_savings_vs_static)} adicionales sobre el óptimo estático "
            f"({format_eur_es(total_savings_vs_all)} frente al banco)"
        )
    else:
        summary_headline = (
            f"Estrategia Óptima Confirmada: Mantén tu selección óptima desde el Año 1 "
            f"(Ahorro total de {format_eur_es(total_savings_vs_all)} frente al banco)"
        )

    return DynamicUnlinkingStrategyResult(
        total_years=total_years,
        dynamic_optimal_total_cost_eur=best_cost,
        static_optimal_total_cost_eur=static_opt_cost,
        all_bonified_total_cost_eur=all_bonified_cost,
        extra_savings_vs_static_optimum_eur=extra_savings_vs_static,
        total_savings_vs_all_bonified_eur=total_savings_vs_all,
        dynamic_tae_real_pct=dynamic_tae,
        summary_headline=summary_headline,
        product_strategies=product_strategies,
    )
