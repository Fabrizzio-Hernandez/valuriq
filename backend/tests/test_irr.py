"""
Tests unitarios del calculador de TAE Real Oculta (TIR / IRR) con Newton-Raphson y Bisección.
"""

from decimal import Decimal

import pytest

from app.domain.amortization import generate_amortization_schedule
from app.domain.irr import (
    calculate_tae_pct,
    monthly_irr_to_annual_tae_pct,
    solve_monthly_irr,
    solve_monthly_irr_bisection,
)
from app.domain.models import LinkedProduct, LinkedProductCategory, MortgageOfferInput, MortgageType
from app.domain.money import ZERO


def test_tae_matches_theoretical_compounded_tin_when_no_fees_or_linkages() -> None:
    """
    En una hipoteca sin gastos iniciales (0 €) ni vinculaciones (0 €), al 3.00% TIN:
    r_mensual = 0.03 / 12 = 0.0025
    TAE teórica = ((1 + 0.0025)^12 - 1) * 100 = 3.04159569...% -> 3.0416%.
    """
    offer = MortgageOfferInput(
        principal_eur=Decimal("200000.00"),
        term_months=360,
        mortgage_type=MortgageType.FIXED,
        base_tin_pct=Decimal("3.00"),
        opening_commission_pct=ZERO,
        appraisal_cost_eur=ZERO,
        other_initial_expenses_eur=ZERO,
    )
    sched = generate_amortization_schedule(offer, accepted_product_ids=set())
    outflows = [r.total_monthly_outflow_eur for r in sched.monthly_schedule]

    tae = calculate_tae_pct(offer.net_received_capital_eur, outflows)
    assert tae == Decimal("3.0416")


def test_tae_real_reflects_opening_commission_appraisal_and_linked_costs() -> None:
    """
    Verifica que la TAE Real aumenta al incluir comisión de apertura, tasación
    y el coste mensualizado de los productos vinculados.
    """
    offer = MortgageOfferInput(
        principal_eur=Decimal("200000.00"),
        term_months=360,
        mortgage_type=MortgageType.FIXED,
        base_tin_pct=Decimal("3.00"),
        opening_commission_pct=Decimal("0.50"),  # 1,000 €
        appraisal_cost_eur=Decimal("450.00"),
        linked_products=[
            LinkedProduct(
                id="vida",
                name="Seguro de Vida",
                category=LinkedProductCategory.LIFE_INSURANCE,
                bonus_pct=Decimal("-0.20"),
                annual_bank_cost_eur=Decimal("720.00"),
                annual_market_cost_eur=Decimal("180.00"),
            )
        ],
    )

    sched = generate_amortization_schedule(offer, accepted_product_ids={"vida"})
    nominal_outflows = [r.monthly_payment_eur for r in sched.monthly_schedule]
    real_outflows = [r.total_monthly_outflow_eur for r in sched.monthly_schedule]

    # TIN bonificado es 2.80%
    assert sched.effective_initial_tin_pct == Decimal("2.8000")

    nominal_tae = calculate_tae_pct(offer.net_received_capital_eur, nominal_outflows)
    real_tae = calculate_tae_pct(offer.net_received_capital_eur, real_outflows)

    # TAE nominal (> 2.836% por gastos iniciales) y TAE Real (> 3.30% por seguro de vida de 720 €/año)
    assert nominal_tae > Decimal("2.8800")
    assert real_tae > Decimal("3.3500")
    assert real_tae > nominal_tae


def test_newton_raphson_and_bisection_converge_to_same_irr() -> None:
    """
    Verifica que el método de Newton-Raphson y el método de Bisección convergen
    a la misma TIR mensual con diferencia menor a 10^-11.
    """
    inflow = Decimal("198500.00")
    outflows = [Decimal("915.40")] * 120 + [Decimal("980.15")] * 240

    irr_newton = solve_monthly_irr(inflow, outflows)
    irr_bisection = solve_monthly_irr_bisection(inflow, outflows)

    assert abs(irr_newton - irr_bisection) < Decimal("1E-10")
    assert monthly_irr_to_annual_tae_pct(irr_newton) == monthly_irr_to_annual_tae_pct(irr_bisection)


def test_newton_raphson_fallback_to_bisection_when_max_iterations_exceeded() -> None:
    """
    Fuerza el fallback a bisección limitando `max_newton_iterations=1` y partiendo
    de una semilla alejada, comprobando que el resultado sigue siendo exacto.
    """
    inflow = Decimal("150000.00")
    outflows = [Decimal("750.00")] * 300

    irr_fallback = solve_monthly_irr(
        inflow,
        outflows,
        initial_guess=Decimal("0.04"),
        max_newton_iterations=1,
    )
    irr_standard = solve_monthly_irr(inflow, outflows)

    assert abs(irr_fallback - irr_standard) < Decimal("1E-10")


def test_irr_zero_and_invalid_inputs() -> None:
    """Verifica caso frontera TIR = 0% y validación de entradas inválidas."""
    assert solve_monthly_irr(Decimal("12000.00"), [Decimal("1000.00")] * 12) == ZERO

    with pytest.raises(ValueError, match="positivo"):
        solve_monthly_irr(Decimal("0.00"), [Decimal("100.00")] * 12)

    with pytest.raises(ValueError, match="vacía"):
        solve_monthly_irr(Decimal("10000.00"), [])
