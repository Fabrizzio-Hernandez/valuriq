"""
Optimizador Combinatorio 2^N de Vinculaciones Hipotecarias para HipoReal.

Evalúa de forma exhaustiva las 2^N combinaciones posibles de productos vinculados,
determinando:
- Escenario A: Hipoteca 100% bonificada (aceptando todo lo propuesto por el banco).
- Escenario B: Hipoteca sin vinculaciones (interés base + seguros externos en mercado libre).
- Escenario C (Óptimo Matemático): El subconjunto exacto de productos a aceptar y rechazar
  que minimiza el desembolso total real a lo largo de la vida del préstamo.
- Ranking completo ordenado por coste total real, ahorro neto en euros y punto de equilibrio.
"""

from decimal import Decimal
from itertools import product

from app.domain.amortization import (
    BaseFrenchSchedule,
    ScheduleComputationResult,
    build_product_monthly_cost_vectors,
    generate_amortization_schedule,
)
from app.domain.irr import calculate_tae_pct
from app.domain.models import (
    CombinationEvaluation,
    MortgageAuditResult,
    MortgageOfferInput,
    OptimizationVerdict,
    YearlySummaryRow,
)
from app.domain.money import ZERO, round_currency, round_rate


def format_eur_es(amount: Decimal) -> str:
    """Formatea un Decimal en estilo moneda española (ej. 12.345,67 €)."""
    q = round_currency(amount)
    sign = "-" if q < ZERO else ""
    abs_str = f"{abs(q):,.2f}"
    # Convertir separador anglosajón (12,345.67) a español (12.345,67)
    es_str = abs_str.replace(",", "_").replace(".", ",").replace("_", ".")
    return f"{sign}{es_str} €"


def calculate_break_even_and_crossover_year(
    target_yearly: list[YearlySummaryRow],
    reference_yearly: list[YearlySummaryRow],
) -> tuple[int | None, int | None]:
    """
    Compara año a año la curva de desembolso total acumulado de `target` frente a `reference`.
    Sea D(y) = CosteAcumulado_ref(y) - CosteAcumulado_target(y).
    (D(y) > 0 significa que `target` es más barato en acumulado hasta el año y).

    Devuelve `(break_even_year, crossover_year)`:
    - `crossover_year`: Primer año y >= 2 en el que cambia qué opción es mejor en acumulado
      (las curvas se cruzan: D(y-1) < 0 y D(y) >= 0, o D(y-1) > 0 y D(y) <= 0).
    - `break_even_year`:
      * Si existe un año en el que `target` pasa de ser más caro/igual a ser más barato que `reference`,
        devuelve ese año de cruce.
      * Si existe un año en el que `target` empieza siendo más barato y deja de serlo, devuelve ese año de cruce.
      * Si `target` ya es estrictamente más barato desde el Año 1 hasta el final sin cruces, devuelve 1.
      * Si `target` nunca mejora a `reference` (idéntico o siempre más caro), devuelve None.
    """
    if not target_yearly or not reference_yearly:
        return None, None

    diffs: list[Decimal] = [
        round_currency(ref.cumulative_total_outflow_eur - tgt.cumulative_total_outflow_eur)
        for tgt, ref in zip(target_yearly, reference_yearly)
    ]

    crossover_year: int | None = None
    for idx in range(1, len(diffs)):
        prev_d = diffs[idx - 1]
        curr_d = diffs[idx]
        if (prev_d < ZERO and curr_d > ZERO) or (prev_d > ZERO and curr_d < ZERO):
            crossover_year = target_yearly[idx].year
            break
        if prev_d < ZERO and curr_d == ZERO:
            crossover_year = target_yearly[idx].year
            break

    if crossover_year is not None:
        return crossover_year, crossover_year

    # Sin cruce intermedio: comprobar si target domina desde el Año 1
    if diffs[0] > ZERO and diffs[-1] > ZERO:
        return 1, None

    # Caso especial: empatados en año 1..k y luego target pasa a ser mejor
    for idx, d_val in enumerate(diffs):
        if d_val > ZERO:
            year_val = target_yearly[idx].year
            return year_val, (year_val if idx > 0 else None)

    return None, None


def _build_verdict(
    offer: MortgageOfferInput,
    scenario_a: CombinationEvaluation,
    scenario_b: CombinationEvaluation,
    scenario_c: CombinationEvaluation,
    worst_scenario: CombinationEvaluation,
) -> OptimizationVerdict:
    """Construye el veredicto ejecutivo explicando la recomendación óptima y el ahorro."""
    savings_vs_a = round_currency(scenario_a.total_cost_eur - scenario_c.total_cost_eur)
    savings_vs_b = round_currency(scenario_b.total_cost_eur - scenario_c.total_cost_eur)
    max_savings = round_currency(worst_scenario.total_cost_eur - scenario_c.total_cost_eur)

    matches_a = set(scenario_c.accepted_product_ids) == set(scenario_a.accepted_product_ids)
    matches_b = len(scenario_c.accepted_product_ids) == 0

    hidden_spread = round_rate(scenario_a.tae_real_pct - scenario_a.effective_initial_tin_pct)

    if not offer.linked_products:
        headline = "Hipoteca sin productos vinculados configurados"
        explanation = (
            f"La oferta no incluye vinculaciones opcionales. El desembolso total real es de "
            f"{format_eur_es(scenario_c.total_cost_eur)} con una TAE Real del {scenario_c.tae_real_pct:.2f}%."
        )
    elif matches_b:
        rejected_str = ", ".join(scenario_c.rejected_product_names)
        headline = (
            f"Rechaza todas las vinculaciones ({rejected_str}) -> "
            f"Ahorras {format_eur_es(savings_vs_a)}"
        )
        explanation = (
            f"Trampa detectada: aunque el banco reduce el TIN hasta el {scenario_a.effective_initial_tin_pct:.2f}% "
            f"aceptando todo, su TAE Real Oculta se dispara al {scenario_a.tae_real_pct:.2f}% "
            f"(+{hidden_spread:.2f} pp de sobrecoste). Contratando la hipoteca sin vinculaciones al "
            f"{scenario_b.effective_initial_tin_pct:.2f}% TIN y acudiendo al mercado libre ahorras "
            f"{format_eur_es(savings_vs_a)} netos."
        )
    elif matches_a:
        accepted_str = " + ".join(scenario_c.accepted_product_names)
        headline = (
            f"Acepta todas las vinculaciones ({accepted_str}) -> "
            f"Ahorras {format_eur_es(savings_vs_b)} frente a no vincular"
        )
        explanation = (
            f"En esta oferta, el descuento de {scenario_a.total_bonus_pct:.2f} pp en el TIN compensa "
            f"el coste de las vinculaciones propuestas, logrando una TAE Real del {scenario_c.tae_real_pct:.2f}% "
            f"y un ahorro neto de {format_eur_es(savings_vs_b)} frente a la hipoteca sin bonificar."
        )
    else:
        accepted_str = " + ".join(scenario_c.accepted_product_names)
        rejected_str = " y ".join(scenario_c.rejected_product_names)
        headline = (
            f"Acepta solo {accepted_str}; rechaza {rejected_str} -> "
            f"Ahorras {format_eur_es(savings_vs_a)}"
        )
        explanation = (
            f"El óptimo matemático ({len(scenario_c.accepted_product_ids)} de {len(offer.linked_products)} "
            f"vinculaciones) rebaja el TIN al {scenario_c.effective_initial_tin_pct:.2f}% evitando los productos "
            f"deficitarios ({rejected_str}). Reduce la TAE Real Oculta del {scenario_a.tae_real_pct:.2f}% al "
            f"{scenario_c.tae_real_pct:.2f}%, ahorrando {format_eur_es(savings_vs_a)} frente a la oferta 100% "
            f"bonificada y {format_eur_es(savings_vs_b)} frente a no vincular nada."
        )

    return OptimizationVerdict(
        headline=headline,
        explanation=explanation,
        optimal_matches_all_bonified=matches_a,
        optimal_matches_unbonified=matches_b,
        net_savings_vs_all_bonified_eur=savings_vs_a,
        net_savings_vs_unbonified_eur=savings_vs_b,
        max_possible_savings_eur=max_savings,
        hidden_tae_spread_pct=hidden_spread,
        break_even_year=scenario_c.break_even_year_vs_all_bonified,
    )


def optimize_mortgage_offer(
    offer: MortgageOfferInput,
    include_all_monthly_schedules: bool = False,
) -> MortgageAuditResult:
    """
    Ejecuta el Optimizador Combinatorio 2^N sobre una oferta hipotecaria.

    Complejidad: O(2^N * M), donde N <= 15 es el número de productos vinculados
    y M es el plazo en meses (ej. 360). Precalcula los vectores de coste mensual de
    cada producto vinculado y cachea los cuadros de amortización por TIN efectivo.
    """
    products = offer.linked_products
    n_products = len(products)
    term_months = offer.term_months
    net_capital = offer.net_received_capital_eur
    initial_expenses = offer.total_initial_expenses_eur

    # Precalcular vectores mensuales de cada producto vinculado una sola vez
    precomputed_vectors = {
        prod.id: build_product_monthly_cost_vectors(prod, term_months, offer.estimated_ipc_pct)
        for prod in products
    }
    french_schedule_cache: dict[tuple[Decimal, int, Decimal, Decimal, int], BaseFrenchSchedule] = {}
    nominal_tae_cache: dict[tuple[Decimal, Decimal, Decimal], Decimal] = {}

    raw_evaluations: list[tuple[CombinationEvaluation, ScheduleComputationResult]] = []

    # Explorar las 2^N combinaciones (0 = rechazar, 1 = aceptar con el banco)
    for bits in product((False, True), repeat=n_products):
        combination_id = "".join("1" if b else "0" for b in bits) if n_products > 0 else "NONE"
        accepted_ids = [products[i].id for i, b in enumerate(bits) if b]
        rejected_ids = [products[i].id for i, b in enumerate(bits) if not b]
        accepted_names = [products[i].name for i, b in enumerate(bits) if b]
        rejected_names = [products[i].name for i, b in enumerate(bits) if not b]
        accepted_set = frozenset(accepted_ids)

        schedule_res = generate_amortization_schedule(
            offer=offer,
            accepted_product_ids=accepted_set,
            precomputed_product_vectors=precomputed_vectors,
            french_schedule_cache=french_schedule_cache,
        )

        total_bonus = sum((products[i].bonus_pct for i, b in enumerate(bits) if b), ZERO)
        total_bonus = round_rate(total_bonus)

        # Serie de flujos mensuales para TAE Real, TAE por Sobrecoste y TAE Nominal
        real_outflows = [row.total_monthly_outflow_eur for row in schedule_res.monthly_schedule]
        overcost_outflows = [
            round_currency(row.monthly_payment_eur + row.linked_overcost_eur)
            for row in schedule_res.monthly_schedule
        ]

        tae_real = calculate_tae_pct(net_capital, real_outflows)
        tae_overcost = calculate_tae_pct(net_capital, overcost_outflows)

        nom_key = (
            schedule_res.financed_principal_eur,
            schedule_res.effective_initial_tin_pct,
            schedule_res.effective_variable_tin_pct,
        )
        if nom_key in nominal_tae_cache:
            nominal_tae = nominal_tae_cache[nom_key]
        else:
            nominal_outflows = [row.monthly_payment_eur for row in schedule_res.monthly_schedule]
            nominal_tae = calculate_tae_pct(net_capital, nominal_outflows)
            nominal_tae_cache[nom_key] = nominal_tae

        total_cost = round_currency(
            initial_expenses
            + offer.principal_eur
            + schedule_res.total_interest_eur
            + schedule_res.total_linked_cost_eur
        )
        initial_total_monthly_outflow = schedule_res.monthly_schedule[0].total_monthly_outflow_eur

        eval_item = CombinationEvaluation(
            combination_id=combination_id,
            rank=1,
            accepted_product_ids=accepted_ids,
            rejected_product_ids=rejected_ids,
            accepted_product_names=accepted_names,
            rejected_product_names=rejected_names,
            total_bonus_pct=total_bonus,
            effective_initial_tin_pct=schedule_res.effective_initial_tin_pct,
            effective_variable_tin_pct=schedule_res.effective_variable_tin_pct,
            initial_monthly_payment_eur=schedule_res.initial_monthly_payment_eur,
            variable_monthly_payment_eur=schedule_res.variable_monthly_payment_eur,
            initial_total_monthly_outflow_eur=initial_total_monthly_outflow,
            principal_eur=offer.principal_eur,
            financed_principal_eur=schedule_res.financed_principal_eur,
            puf_financed_amount_eur=schedule_res.puf_financed_amount_eur,
            puf_extra_interest_eur=schedule_res.puf_extra_interest_eur,
            initial_expenses_eur=initial_expenses,
            total_interest_eur=schedule_res.total_interest_eur,
            total_mortgage_payments_eur=schedule_res.total_mortgage_payments_eur,
            total_linked_bank_cost_eur=schedule_res.total_linked_bank_cost_eur,
            total_linked_market_cost_eur=schedule_res.total_linked_market_cost_eur,
            total_linked_cost_eur=schedule_res.total_linked_cost_eur,
            total_linked_overcost_eur=schedule_res.total_linked_overcost_eur,
            total_cost_eur=total_cost,
            tae_real_pct=tae_real,
            tae_overcost_pct=tae_overcost,
            nominal_tae_pct=nominal_tae,
            yearly_summary=schedule_res.yearly_summary,
            monthly_schedule=schedule_res.monthly_schedule if include_all_monthly_schedules else [],
        )
        raw_evaluations.append((eval_item, schedule_res))

    # Identificar Escenario A (todo 1s) y Escenario B (todo 0s) antes de ordenar
    all_ones_id = "1" * n_products if n_products > 0 else "NONE"
    all_zeros_id = "0" * n_products if n_products > 0 else "NONE"

    raw_a = next(item for item in raw_evaluations if item[0].combination_id == all_ones_id)
    raw_b = next(item for item in raw_evaluations if item[0].combination_id == all_zeros_id)

    cost_a = raw_a[0].total_cost_eur
    cost_b = raw_b[0].total_cost_eur
    yearly_a = raw_a[0].yearly_summary

    # Ordenar de menor a mayor coste total real (desempate: menos vinculaciones, menor TAE Real)
    raw_evaluations.sort(
        key=lambda pair: (
            pair[0].total_cost_eur,
            len(pair[0].accepted_product_ids),
            pair[0].tae_real_pct,
        )
    )

    optimal_comb_id = raw_evaluations[0][0].combination_id
    primary_ids = {all_ones_id, all_zeros_id, optimal_comb_id}

    ranked_evaluations: list[CombinationEvaluation] = []
    for rank_idx, (eval_item, sched_res) in enumerate(raw_evaluations, start=1):
        savings_a = round_currency(cost_a - eval_item.total_cost_eur)
        savings_b = round_currency(cost_b - eval_item.total_cost_eur)
        be_year, cross_year = calculate_break_even_and_crossover_year(
            target_yearly=eval_item.yearly_summary,
            reference_yearly=yearly_a,
        )

        keep_monthly = include_all_monthly_schedules or (eval_item.combination_id in primary_ids)
        enriched = eval_item.model_copy(
            update={
                "rank": rank_idx,
                "savings_vs_all_bonified_eur": savings_a,
                "savings_vs_unbonified_eur": savings_b,
                "break_even_year_vs_all_bonified": be_year,
                "crossover_year_vs_all_bonified": cross_year,
                "monthly_schedule": sched_res.monthly_schedule if keep_monthly else [],
            }
        )
        ranked_evaluations.append(enriched)

    scenario_c = ranked_evaluations[0]
    scenario_a = next(item for item in ranked_evaluations if item.combination_id == all_ones_id)
    scenario_b = next(item for item in ranked_evaluations if item.combination_id == all_zeros_id)
    worst_scenario = ranked_evaluations[-1]

    verdict = _build_verdict(
        offer=offer,
        scenario_a=scenario_a,
        scenario_b=scenario_b,
        scenario_c=scenario_c,
        worst_scenario=worst_scenario,
    )

    return MortgageAuditResult(
        offer=offer,
        total_combinations_evaluated=len(ranked_evaluations),
        scenario_a_all_bonified=scenario_a,
        scenario_b_unbonified=scenario_b,
        scenario_c_optimal=scenario_c,
        verdict=verdict,
        ranking=ranked_evaluations,
    )
