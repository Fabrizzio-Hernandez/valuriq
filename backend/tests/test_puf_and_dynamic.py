"""
Tests unitarios de ETAPA 1:
1. Detector de Prima Única Financiada (PUF_FINANCED) e intereses compuestos extra.
2. Motor de Desvinculación Dinámica por años (`dynamic_unlinking.py`).
"""

from decimal import Decimal

import pytest

from app.domain.amortization import (
    calculate_french_monthly_payment,
    generate_amortization_schedule,
)
from app.domain.dynamic_unlinking import optimize_dynamic_unlinking_strategy
from app.domain.models import (
    LinkedProduct,
    LinkedProductCategory,
    LinkedProductPaymentMode,
    MortgageOfferInput,
    MortgageType,
)
from app.domain.money import ZERO
from app.domain.optimizer import optimize_mortgage_offer
from app.domain.presets import get_spanish_mortgage_presets


def test_puf_financed_adds_to_principal_and_calculates_exact_extra_interest() -> None:
    """
    Verifica que un producto con `payment_mode = PUF_FINANCED` de 12.000 € y cobertura
    de 15 años sobre una hipoteca de 200.000 € a 30 años (3.00% TIN efectivo):
    - Suma 12.000 € al principal financiado en t=0 (212.000 €).
    - Incrementa la cuota mensual de 843.21 € a 893.80 €.
    - Calcula `puf_extra_interest_eur` (> 6.200 € de intereses compuestos solo por el seguro).
    - Durante los años 1..15 el coste recurrente es 0.00 € y en los años 16..30 aplica el coste de mercado libre.
    """
    puf_prod = LinkedProduct(
        id="vida_puf",
        name="Seguro de Vida PUF 15 años",
        category=LinkedProductCategory.LIFE_INSURANCE,
        bonus_pct=Decimal("-0.30"),
        annual_bank_cost_eur=ZERO,
        annual_market_cost_eur=Decimal("240.00"),
        apply_ipc=False,
        payment_mode=LinkedProductPaymentMode.PUF_FINANCED,
        puf_amount_eur=Decimal("12000.00"),
        puf_coverage_years=15,
    )
    offer = MortgageOfferInput(
        principal_eur=Decimal("200000.00"),
        term_months=360,
        mortgage_type=MortgageType.FIXED,
        base_tin_pct=Decimal("3.30"),
        appraisal_cost_eur=ZERO,
        linked_products=[puf_prod],
    )

    sched_accepted = generate_amortization_schedule(offer, accepted_product_ids={"vida_puf"})

    assert sched_accepted.effective_initial_tin_pct == Decimal("3.0000")
    assert sched_accepted.puf_financed_amount_eur == Decimal("12000.00")
    assert sched_accepted.financed_principal_eur == Decimal("212000.00")

    expected_quota_212k = calculate_french_monthly_payment(
        Decimal("212000.00"), Decimal("3.00"), 360
    )
    assert expected_quota_212k == Decimal("893.80")
    assert sched_accepted.initial_monthly_payment_eur == Decimal("893.80")

    # Los intereses extra de financiar 12.000 € al 3.00% durante 30 años superan los 6.200 €
    assert sched_accepted.puf_extra_interest_eur > Decimal("6200.00")

    # Durante los primeros 15 años (meses 1..180), el coste recurrente de seguros fuera de cuota es 0.00 €
    for m_idx in range(180):
        row = sched_accepted.monthly_schedule[m_idx]
        assert row.linked_bank_cost_eur == ZERO
        assert row.linked_market_cost_eur == ZERO

    # A partir del año 16 (meses 181..360), aplica el seguro en mercado libre (240 €/año = 20 €/mes)
    for m_idx in range(180, 360):
        row = sched_accepted.monthly_schedule[m_idx]
        assert row.linked_bank_cost_eur == ZERO
        assert row.linked_market_cost_eur == Decimal("20.00")

    # El saldo final en el mes 360 es 0.00 € y la suma de principal amortizado es 212.000,00 €
    assert sched_accepted.monthly_schedule[-1].remaining_balance_eur == ZERO
    total_amortized = sum((r.principal_eur for r in sched_accepted.monthly_schedule), ZERO)
    assert total_amortized == Decimal("212000.00")


def test_puf_validation_requires_positive_amount() -> None:
    """Un producto `PUF_FINANCED` con `puf_amount_eur == 0` debe lanzar ValueError."""
    with pytest.raises(ValueError, match="puf_amount_eur"):
        LinkedProduct(
            id="puf_invalida",
            name="PUF sin importe",
            bonus_pct=Decimal("0.20"),
            payment_mode=LinkedProductPaymentMode.PUF_FINANCED,
            puf_amount_eur=ZERO,
        )


def test_fija_trampa_puf_preset_detects_puf_trap_and_increases_tae_real() -> None:
    """
    Verifica el preset `fija_trampa_puf`:
    - En el Escenario A (aceptando todo incluida la PUF de 12.000 €), `puf_financed_amount_eur == 12000.00`
      y `puf_extra_interest_eur > 5000.00`.
    - El capital neto recibido en t=0 sigue siendo 220.000 - 450 = 219.550 €, disparando la TAE Real.
    - El Escenario C (Óptimo) rechaza `vida_puf` y `alarma`, aceptando solo `nomina` y `hogar`.
    """
    offer = get_spanish_mortgage_presets()["fija_trampa_puf"]
    audit = optimize_mortgage_offer(offer)

    scen_a = audit.scenario_a_all_bonified
    scen_c = audit.scenario_c_optimal

    assert offer.net_received_capital_eur == Decimal("219550.00")
    assert scen_a.puf_financed_amount_eur == Decimal("12000.00")
    assert scen_a.financed_principal_eur == Decimal("232000.00")
    assert scen_a.puf_extra_interest_eur > Decimal("5000.00")

    assert set(scen_c.accepted_product_ids) == {"nomina", "hogar"}
    assert "vida_puf" in scen_c.rejected_product_ids
    assert scen_c.puf_financed_amount_eur == ZERO
    assert scen_c.total_cost_eur < scen_a.total_cost_eur


def test_dynamic_unlinking_finds_exact_cancellation_year_and_beats_static_optimum() -> None:
    """
    Verifica que en `fija_tipica_trampa`:
    - `nomina` se mantiene los 30 años ("Mantener toda la hipoteca").
    - `alarma` se rechaza desde el día 1 ("Rechazar desde el día 1").
    - `hogar` y `vida` son rentables durante los primeros años (cuando el saldo vivo de 220.000 €
      es alto) y se cancelan exactamente en el año en que su sobrecoste anual supera el ahorro
      en intereses ("Aceptar años 1 a X y cancelar en el año X+1").
    - El desembolso total dinámico mejora estrictamente al Escenario C estático
      (`extra_savings_vs_static_optimum_eur > 0`).
    """
    offer = get_spanish_mortgage_presets()["fija_tipica_trampa"]
    dyn = optimize_dynamic_unlinking_strategy(offer)

    assert dyn.total_years == 30
    assert dyn.dynamic_optimal_total_cost_eur < dyn.static_optimal_total_cost_eur
    assert dyn.extra_savings_vs_static_optimum_eur > Decimal("500.00")
    assert (
        dyn.extra_savings_vs_static_optimum_eur
        == dyn.static_optimal_total_cost_eur - dyn.dynamic_optimal_total_cost_eur
    )

    by_id = {p.product_id: p for p in dyn.product_strategies}

    # Nómina: coste 0 € -> Mantener toda la hipoteca (30 años)
    assert by_id["nomina"].keep_years == 30
    assert by_id["nomina"].cancel_at_year is None
    assert by_id["nomina"].recommendation == "Mantener toda la hipoteca"

    # Alarma: deficitaria desde el Año 1 -> Rechazar desde el día 1 (0 años)
    assert by_id["alarma"].keep_years == 0
    assert by_id["alarma"].cancel_at_year is None
    assert by_id["alarma"].recommendation == "Rechazar desde el día 1"
    assert by_id["alarma"].crossover_year == 1

    # Seguro de Hogar: rentable los primeros ~18 años y luego se cancela antes del año 30
    hogar_strat = by_id["hogar"]
    assert 10 <= hogar_strat.keep_years < 30
    assert hogar_strat.cancel_at_year == hogar_strat.keep_years + 1
    assert (
        hogar_strat.recommendation
        == f"Aceptar años 1 a {hogar_strat.keep_years} y cancelar en el año {hogar_strat.cancel_at_year}"
    )
    assert len(hogar_strat.yearly_breakdown) == 30
