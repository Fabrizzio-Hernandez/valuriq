"""
Tests unitarios de ETAPA 2 (Dominio Puro en Decimal):
1. Calculadora "Dinero Real el Día 1" (ITP / IVA+AJD en las 17 CCAA + Ceuta y Melilla, tipo general y joven).
2. Test de Estrés de Euríbor (2%, 3%, 4%, 5%) + Tasa de Esfuerzo (Umbral 35% Banco de España).
3. Modo Batalla de Bancos (Comparador de 2 a 3 ofertas reales).
"""

from decimal import Decimal

import pytest

from app.domain.comparison import compare_mortgage_offers_battle
from app.domain.day_one_costs import (
    DayOneCostsInput,
    PropertyTaxRegime,
    calculate_day_one_costs,
    list_spanish_regions_tax_rules,
)
from app.domain.models import MortgageOfferInput, MortgageType
from app.domain.money import ZERO
from app.domain.presets import get_bank_battle_preset, get_spanish_mortgage_presets
from app.domain.stress_test import (
    EffortRiskLevel,
    run_euribor_stress_and_effort_test,
)


def test_spanish_regions_catalog_contains_all_19_territories() -> None:
    """Verifica que el catálogo contiene las 17 Comunidades Autónomas + Ceuta y Melilla (19 regiones)."""
    regions = list_spanish_regions_tax_rules()
    assert len(regions) == 19
    codes = {r.code for r in regions}
    assert {"MADRID", "CATALUNA", "ANDALUCIA", "VALENCIA", "PAIS_VASCO", "CANARIAS", "CEUTA", "MELILLA"}.issubset(codes)


@pytest.mark.parametrize(
    ("region_code", "regime", "young", "expected_itp_pct", "expected_iva_pct", "expected_ajd_pct"),
    [
        ("MADRID", PropertyTaxRegime.SECOND_HAND, False, Decimal("6.00"), ZERO, ZERO),
        ("MADRID", PropertyTaxRegime.SECOND_HAND, True, Decimal("5.40"), ZERO, ZERO),
        ("CATALUNA", PropertyTaxRegime.SECOND_HAND, False, Decimal("10.00"), ZERO, ZERO),
        ("CATALUNA", PropertyTaxRegime.SECOND_HAND, True, Decimal("5.00"), ZERO, ZERO),
        ("ANDALUCIA", PropertyTaxRegime.SECOND_HAND, True, Decimal("3.50"), ZERO, ZERO),
        ("MADRID", PropertyTaxRegime.NEW_BUILD, False, ZERO, Decimal("10.00"), Decimal("0.75")),
        ("CANARIAS", PropertyTaxRegime.NEW_BUILD, False, ZERO, Decimal("7.00"), Decimal("0.75")),
        ("VALENCIA", PropertyTaxRegime.NEW_BUILD_VPO, True, ZERO, Decimal("4.00"), Decimal("0.10")),
    ],
)
def test_day_one_costs_itp_iva_ajd_across_autonomous_communities(
    region_code: str,
    regime: PropertyTaxRegime,
    young: bool,
    expected_itp_pct: Decimal,
    expected_iva_pct: Decimal,
    expected_ajd_pct: Decimal,
) -> None:
    """
    Verifica el cálculo exacto en `Decimal` de Entrada + Impuestos (ITP o IVA/IGIC + AJD) + Gastos
    para distintas Comunidades Autónomas y modalidades (Segunda Mano, Obra Nueva, Tipo Joven).
    """
    inp = DayOneCostsInput(
        property_price_eur=Decimal("250000.00"),
        financing_pct=Decimal("80.00"),
        region_code=region_code,
        property_regime=regime,
        apply_young_buyer_reduction=young,
        notary_cost_eur=Decimal("900.00"),
        registry_cost_eur=Decimal("500.00"),
        gestoria_cost_eur=Decimal("400.00"),
        appraisal_cost_eur=Decimal("450.00"),
    )
    res = calculate_day_one_costs(inp)

    assert res.mortgage_principal_eur == Decimal("200000.00")
    assert res.down_payment_eur == Decimal("50000.00")
    assert res.applied_itp_pct == expected_itp_pct
    assert res.applied_iva_pct == expected_iva_pct
    assert res.applied_ajd_pct == expected_ajd_pct

    expected_taxes = (
        Decimal("250000.00") * (expected_itp_pct + expected_iva_pct + expected_ajd_pct) / Decimal("100")
    )
    assert res.total_taxes_eur == expected_taxes
    assert res.total_formalization_expenses_eur == Decimal("2250.00")
    assert res.total_cash_needed_day_one_eur == Decimal("50000.00") + expected_taxes + Decimal("2250.00")

    if young and regime == PropertyTaxRegime.SECOND_HAND:
        assert res.young_buyer_tax_savings_eur > ZERO


def test_stress_test_effort_ratio_and_35_pct_breach_at_euribor_5_pct() -> None:
    """
    Verifica el cálculo de la Tasa de Esfuerzo y la rotura del límite del 35% del Banco de España
    en una hipoteca Mixta/Variable cuando el Euríbor sube al 5.00%.
    """
    offer = get_spanish_mortgage_presets()["variable_agresiva"]
    # Ingresos netos del hogar: 2.800 €/mes -> Límite 35% BdE = 980,00 €/mes
    res = run_euribor_stress_and_effort_test(
        offer=offer,
        monthly_net_household_income_eur=Decimal("2800.00"),
    )

    assert res.max_prudent_monthly_outflow_30_pct_eur == Decimal("840.00")
    assert res.max_recommended_monthly_outflow_35_pct_eur == Decimal("980.00")
    assert len(res.scenarios) == 4
    assert [s.euribor_pct for s in res.scenarios] == [
        Decimal("2.00"),
        Decimal("3.00"),
        Decimal("4.00"),
        Decimal("5.00"),
    ]

    # A Euríbor 2.00% la tasa de esfuerzo es saludable/ajustada (<= 35%)
    scen_2 = res.scenarios[0]
    assert not scen_2.exceeds_35_pct_limit

    # A Euríbor 5.00% la cuota se dispara y rompe el umbral del 35% (RISK)
    scen_5 = res.scenarios[3]
    assert scen_5.exceeds_35_pct_limit is True
    assert scen_5.risk_level == EffortRiskLevel.RISK
    assert scen_5.effort_ratio_pct > Decimal("35.00")
    assert res.critical_euribor_35_pct is not None
    assert Decimal("2.00") < res.critical_euribor_35_pct < Decimal("5.00")


def test_stress_test_fixed_mortgage_remains_constant_across_euribor_levels() -> None:
    """En una hipoteca FIXED (Fija), la cuota y la tasa de esfuerzo no varían aunque suba el Euríbor."""
    offer = get_spanish_mortgage_presets()["fija_tipica_trampa"]
    res = run_euribor_stress_and_effort_test(
        offer=offer,
        monthly_net_household_income_eur=Decimal("3500.00"),
    )

    assert res.is_fixed_rate_protected is True
    assert res.critical_euribor_35_pct is None
    assert res.initial_risk_level == EffortRiskLevel.HEALTHY
    for s in res.scenarios:
        assert s.delta_vs_initial_outflow_eur == ZERO
        assert s.effort_ratio_pct == res.initial_effort_ratio_pct


def test_bank_battle_compares_3_banks_and_validates_bounds() -> None:
    """
    Verifica el Modo Batalla con las 3 ofertas del preset (`get_bank_battle_preset`),
    coronando al banco con menor Desembolso Total Real en su Escenario Óptimo y
    validando el rechazo si se pasa 1 oferta o más de 3 ofertas.
    """
    offers = get_bank_battle_preset()
    assert len(offers) == 3

    battle = compare_mortgage_offers_battle(offers)
    assert battle.total_offers_compared == 3
    assert len(battle.entries) == 3

    winner = battle.entries[0]
    second = battle.entries[1]
    third = battle.entries[2]

    assert winner.rank == 1 and winner.is_winner is True
    assert winner.diff_vs_winner_eur == ZERO
    assert winner.optimal_scenario.total_cost_eur <= second.optimal_scenario.total_cost_eur
    assert second.optimal_scenario.total_cost_eur <= third.optimal_scenario.total_cost_eur
    assert battle.savings_vs_second_eur == second.diff_vs_winner_eur
    assert battle.savings_vs_last_eur == third.diff_vs_winner_eur

    # Validar rechazo con < 2 o > 3 ofertas
    with pytest.raises(ValueError, match="entre 2 y 3"):
        compare_mortgage_offers_battle([offers[0]])

    with pytest.raises(ValueError, match="entre 2 y 3"):
        compare_mortgage_offers_battle([offers[0], offers[1], offers[2], offers[0]])
