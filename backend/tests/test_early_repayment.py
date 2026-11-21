"""
Tests unitarios del Simulador de Amortización Anticipada (Reducir Cuota vs Reducir Plazo).
"""

from decimal import Decimal

from app.domain.early_repayment import (
    compare_early_repayment_strategies,
    simulate_early_repayment_strategy,
)
from app.domain.models import (
    EarlyRepaymentConfig,
    EarlyRepaymentFrequency,
    EarlyRepaymentStrategy,
    MortgageOfferInput,
    MortgageType,
)
from app.domain.money import ZERO


def _base_offer() -> MortgageOfferInput:
    return MortgageOfferInput(
        offer_name="Hipoteca Fija 200k 3.00%",
        principal_eur=Decimal("200000.00"),
        term_months=360,
        mortgage_type=MortgageType.FIXED,
        base_tin_pct=Decimal("3.00"),
        opening_commission_pct=ZERO,
        appraisal_cost_eur=ZERO,
    )


def test_one_off_early_repayment_reduce_term_saves_more_than_reduce_payment() -> None:
    """
    Verifica una amortización anticipada puntual de 20.000 € en el mes 24:
    - Reducir Plazo mantiene la cuota mensual constante (843.21 €), acorta la vida de la hipoteca
      y genera un ahorro de intereses significativamente mayor que Reducir Cuota.
    - Reducir Cuota mantiene los 360 meses pero reduce la cuota mensual a partir del mes 25.
    - En ambas estrategias la suma de capital amortizado ordinario + extraordinario == 200.000,00 €
      y el saldo final es 0.00 €.
    """
    offer = _base_offer()
    config = EarlyRepaymentConfig(
        amount_eur=Decimal("20000.00"),
        frequency=EarlyRepaymentFrequency.ONE_OFF,
        start_month=24,
        commission_pct=Decimal("0.00"),
    )

    comp = compare_early_repayment_strategies(offer, config)

    # Estrategia Reducir Plazo
    rt = comp.reduce_term
    assert rt.months_saved > 40
    assert rt.new_term_months == 360 - rt.months_saved
    assert rt.monthly_payment_after_first_repayment_eur == rt.initial_monthly_payment_eur
    assert rt.total_early_repaid_eur == Decimal("20000.00")
    assert rt.schedule[-1].remaining_balance_eur == Decimal("0.00")

    # Estrategia Reducir Cuota
    rp = comp.reduce_payment
    assert rp.new_term_months == 360
    assert rp.months_saved == 0
    assert rp.monthly_payment_after_first_repayment_eur < rp.initial_monthly_payment_eur
    assert rp.total_early_repaid_eur == Decimal("20000.00")
    assert rp.schedule[-1].remaining_balance_eur == Decimal("0.00")

    # Reducir Plazo ahorra más intereses que Reducir Cuota
    assert rt.net_savings_eur > rp.net_savings_eur > ZERO
    assert comp.recommended_strategy == EarlyRepaymentStrategy.REDUCE_TERM
    assert comp.extra_savings_reducing_term_eur == rt.net_savings_eur - rp.net_savings_eur

    # Verificar conservación exacta del principal en ambas estrategias
    for strat_res in (rt, rp):
        total_principal = sum(
            (r.regular_principal_eur + r.early_repayment_eur for r in strat_res.schedule),
            ZERO,
        )
        assert total_principal == offer.principal_eur


def test_periodic_annual_early_repayment_with_commission() -> None:
    """
    Verifica amortizaciones periódicas anuales (5.000 €/año desde el mes 12 hasta el mes 120)
    con una comisión por amortización anticipada del 0.25%.
    """
    offer = _base_offer()
    config = EarlyRepaymentConfig(
        amount_eur=Decimal("5000.00"),
        frequency=EarlyRepaymentFrequency.ANNUAL,
        start_month=12,
        end_month=120,
        commission_pct=Decimal("0.25"),
    )

    comp = compare_early_repayment_strategies(offer, config)
    rt = comp.reduce_term

    # 10 aportaciones anuales de 5.000 € (meses 12, 24, ..., 120) = 50.000 €
    assert rt.total_early_repaid_eur == Decimal("50000.00")
    # Comisión del 0.25% sobre 50.000 € = 125.00 €
    assert rt.total_commission_paid_eur == Decimal("125.00")
    assert rt.net_savings_eur == rt.gross_interest_saved_eur - Decimal("125.00")


def test_early_repayment_exceeding_remaining_balance_caps_cleanly() -> None:
    """
    Si el usuario introduce un importe de amortización anticipada superior al saldo pendiente,
    el simulador amortiza exactamente el saldo vivo restante y cierra el préstamo en ese mes.
    """
    offer = _base_offer()
    config = EarlyRepaymentConfig(
        amount_eur=Decimal("500000.00"),
        frequency=EarlyRepaymentFrequency.ONE_OFF,
        start_month=12,
        commission_pct=Decimal("1.00"),
    )

    res = simulate_early_repayment_strategy(
        offer=offer,
        config=config,
        strategy=EarlyRepaymentStrategy.REDUCE_TERM,
    )

    assert res.new_term_months == 12
    assert res.months_saved == 348
    assert res.schedule[-1].remaining_balance_eur == Decimal("0.00")
    total_principal = sum(
        (r.regular_principal_eur + r.early_repayment_eur for r in res.schedule),
        ZERO,
    )
    assert total_principal == Decimal("200000.00")


def test_mixed_mortgage_reduce_term_preserves_shortened_term_after_tranche_switch() -> None:
    """
    Verifica que si se realiza una amortización anticipada durante el tramo fijo (mes 24)
    de una hipoteca MIXTA (5 años fijos al 2.10% + tramo variable al 3.50%), al llegar al
    cambio de tramo (mes 61) la estrategia REDUCE_TERM recalcula la nueva cuota sobre el
    plazo efectivo reducido y no se degrada en REDUCE_PAYMENT estirando de nuevo a 360 meses.
    """
    mixed_offer = MortgageOfferInput(
        offer_name="Mixta 5a 250k",
        principal_eur=Decimal("250000.00"),
        term_months=360,
        mortgage_type=MortgageType.MIXED,
        base_tin_pct=Decimal("2.10"),
        fixed_years=5,
        euribor_pct=Decimal("2.50"),
        differential_pct=Decimal("1.00"),
        opening_commission_pct=ZERO,
        appraisal_cost_eur=ZERO,
    )
    config = EarlyRepaymentConfig(
        amount_eur=Decimal("30000.00"),
        frequency=EarlyRepaymentFrequency.ONE_OFF,
        start_month=24,
        commission_pct=Decimal("0.00"),
    )

    comp = compare_early_repayment_strategies(mixed_offer, config)
    rt = comp.reduce_term
    rp = comp.reduce_payment

    assert rt.months_saved >= 45
    assert rt.new_term_months == 360 - rt.months_saved
    assert rp.new_term_months == 360
    assert rt.net_savings_eur > rp.net_savings_eur
