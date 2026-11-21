"""
Tests unitarios del Optimizador Combinatorio 2^N, Escenarios A/B/C y punto de equilibrio.
"""

from decimal import Decimal

from app.domain.models import LinkedProduct, LinkedProductCategory, MortgageOfferInput, MortgageType
from app.domain.money import ZERO
from app.domain.optimizer import optimize_mortgage_offer
from app.domain.presets import get_spanish_mortgage_presets


def test_combinatorial_optimizer_evaluates_all_2_pow_n_combinations() -> None:
    """
    Verifica que para N=4 productos vinculados el optimizador evalúa exactamente
    2^4 = 16 combinaciones y devuelve el ranking estrictamente ordenado por coste total real.
    """
    presets = get_spanish_mortgage_presets()
    offer = presets["fija_tipica_trampa"]

    audit = optimize_mortgage_offer(offer)

    assert len(offer.linked_products) == 4
    assert audit.total_combinations_evaluated == 16
    assert len(audit.ranking) == 16

    # Verificar orden creciente estricto o monótono por total_cost_eur y ranks 1..16
    for idx, item in enumerate(audit.ranking, start=1):
        assert item.rank == idx
        if idx > 1:
            assert item.total_cost_eur >= audit.ranking[idx - 2].total_cost_eur


def test_optimizer_detects_spanish_linkage_trap_and_finds_mathematical_optimum() -> None:
    """
    En la oferta fija típica española (3.40% base -> 2.60% bonificada con Nómina, Hogar, Vida y Alarma):
    - Nómina (-0.30%, coste 0 €) es rentable.
    - Seguro de Hogar (-0.15%, sobrecoste 195 €/año) compensa el ahorro de intereses en 220.000 €.
    - Seguro de Vida (-0.25%, 680 €/año con subida por IPC + 3.5% edad anual) es una trampa deficitaria.
    - Alarma (-0.10%, 580 €/año con IPC, coste mercado 0 €) es una trampa deficitaria.
    El Escenario C (Óptimo) debe aceptar solo Nómina + Hogar y rechazar Vida y Alarma.
    """
    offer = get_spanish_mortgage_presets()["fija_tipica_trampa"]
    audit = optimize_mortgage_offer(offer)

    scen_a = audit.scenario_a_all_bonified
    scen_b = audit.scenario_b_unbonified
    scen_c = audit.scenario_c_optimal

    # Escenario A acepta los 4 productos (TIN 2.60%)
    assert set(scen_a.accepted_product_ids) == {"nomina", "hogar", "vida", "alarma"}
    assert scen_a.effective_initial_tin_pct == Decimal("2.6000")

    # Escenario B rechaza los 4 productos (TIN 3.40%)
    assert scen_b.accepted_product_ids == []
    assert scen_b.effective_initial_tin_pct == Decimal("3.4000")

    # Escenario C (Óptimo Matemático) acepta solo Nómina + Hogar (TIN 2.95%) y rechaza Vida y Alarma
    assert set(scen_c.accepted_product_ids) == {"nomina", "hogar"}
    assert set(scen_c.rejected_product_ids) == {"vida", "alarma"}
    assert scen_c.effective_initial_tin_pct == Decimal("2.9500")

    # El desembolso total real de C es considerablemente menor que A y B
    assert scen_c.total_cost_eur < scen_a.total_cost_eur
    assert scen_c.total_cost_eur < scen_b.total_cost_eur

    # Ahorro neto frente a aceptar todo supera los 20.000 € a lo largo de los 30 años
    assert audit.verdict.net_savings_vs_all_bonified_eur > Decimal("20000.00")
    assert audit.verdict.net_savings_vs_unbonified_eur > Decimal("10000.00")
    assert audit.verdict.hidden_tae_spread_pct > Decimal("0.8000")

    # Los tres escenarios principales incluyen su cuadro de amortización mensual completo (360 meses)
    assert len(scen_a.monthly_schedule) == 360
    assert len(scen_b.monthly_schedule) == 360
    assert len(scen_c.monthly_schedule) == 360


def test_optimizer_crossover_break_even_year_when_life_insurance_escalates_with_age() -> None:
    """
    Construye un caso donde un seguro de vida tiene un sobrecoste bajo en el Año 1
    (menor que el ahorro inicial de intereses del -0.30% TIN), por lo que en el Año 1
    vincularse es más barato, pero al crecer la prima un 8% anual por edad mientras
    baja el capital pendiente, las curvas de coste acumulado se cruzan en un año k > 1.
    """
    offer = MortgageOfferInput(
        offer_name="Cruce de Curvas Seguro de Vida por Edad",
        principal_eur=Decimal("200000.00"),
        term_months=360,
        mortgage_type=MortgageType.FIXED,
        base_tin_pct=Decimal("3.30"),
        opening_commission_pct=ZERO,
        appraisal_cost_eur=ZERO,
        estimated_ipc_pct=Decimal("2.00"),
        linked_products=[
            LinkedProduct(
                id="vida_creciente",
                name="Seguro de Vida Prima Creciente por Edad",
                category=LinkedProductCategory.LIFE_INSURANCE,
                bonus_pct=Decimal("-0.30"),
                annual_bank_cost_eur=Decimal("310.00"),
                annual_market_cost_eur=Decimal("0.00"),
                apply_ipc=True,
                annual_age_increase_pct=Decimal("6.00"),  # +8% anual total
            )
        ],
    )

    audit = optimize_mortgage_offer(offer)
    scen_a = audit.scenario_a_all_bonified
    scen_c = audit.scenario_c_optimal

    # El óptimo a 30 años es rechazar el seguro de vida creciente
    assert scen_c.accepted_product_ids == []
    assert scen_c.total_cost_eur < scen_a.total_cost_eur

    # En el Año 1, el ahorro de cuota (3.00% vs 3.30% = ~32.78 €/mes = 393.36 €/año)
    # supera los 310 € del seguro, por lo que en el Año 1 el Escenario A es más barato.
    assert scen_a.yearly_summary[0].cumulative_total_outflow_eur < scen_c.yearly_summary[0].cumulative_total_outflow_eur

    # Pero al cabo de unos años, la prima creciente hace que las curvas se crucen (break_even_year > 1)
    assert scen_c.crossover_year_vs_all_bonified is not None
    assert scen_c.crossover_year_vs_all_bonified > 1
    assert scen_c.break_even_year_vs_all_bonified == scen_c.crossover_year_vs_all_bonified
