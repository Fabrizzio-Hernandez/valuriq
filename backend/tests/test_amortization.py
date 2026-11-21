"""
Tests unitarios del motor de amortización francés y reglas de arquitectura limpia.
"""

import ast
from decimal import Decimal
from pathlib import Path

import pytest

from app.domain.amortization import (
    build_product_monthly_cost_vectors,
    calculate_french_monthly_payment,
    generate_amortization_schedule,
    resolve_effective_tins,
)
from app.domain.models import (
    LinkedProduct,
    LinkedProductCategory,
    MortgageOfferInput,
    MortgageType,
)
from app.domain.money import ZERO, ensure_decimal, round_currency


def test_clean_architecture_domain_has_no_fastapi_or_sqlalchemy_imports() -> None:
    """
    Regla técnica estricta #2:
    Toda la lógica financiera en `/backend/app/domain/` debe estar libre de
    dependencias de FastAPI y SQLAlchemy.
    """
    domain_dir = Path(__file__).resolve().parent.parent / "app" / "domain"
    forbidden_roots = {"fastapi", "sqlalchemy", "starlette", "alembic"}

    py_files = list(domain_dir.glob("*.py"))
    assert len(py_files) >= 6

    for py_file in py_files:
        tree = ast.parse(py_file.read_text(encoding="utf-8"), filename=str(py_file))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    root_pkg = alias.name.split(".")[0].lower()
                    assert root_pkg not in forbidden_roots, (
                        f"Import prohibido '{alias.name}' detectado en {py_file.name}"
                    )
            elif isinstance(node, ast.ImportFrom) and node.module:
                root_pkg = node.module.split(".")[0].lower()
                assert root_pkg not in forbidden_roots, (
                    f"Import prohibido 'from {node.module}' detectado en {py_file.name}"
                )


def test_float_is_strictly_rejected_in_money_and_models() -> None:
    """
    Regla técnica estricta #1:
    Prohibido usar `float` para dinero, tipos de interés o cuotas.
    """
    with pytest.raises(TypeError, match="float"):
        ensure_decimal(200000.0)  # type: ignore[arg-type]

    with pytest.raises(TypeError, match="float"):
        round_currency(123.45)  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="float"):
        MortgageOfferInput(
            principal_eur=200000.0,  # type: ignore[arg-type]
            term_months=360,
            base_tin_pct=Decimal("3.00"),
        )


@pytest.mark.parametrize(
    ("principal", "tin_pct", "months", "expected_quota"),
    [
        (Decimal("200000.00"), Decimal("3.00"), 360, Decimal("843.21")),
        (Decimal("150000.00"), Decimal("2.50"), 240, Decimal("794.85")),
        (Decimal("250000.00"), Decimal("3.50"), 360, Decimal("1122.61")),
        (Decimal("180000.00"), Decimal("2.60"), 360, Decimal("720.61")),
        (Decimal("100000.00"), Decimal("0.00"), 100, Decimal("1000.00")),
    ],
)
def test_known_french_monthly_payments(
    principal: Decimal,
    tin_pct: Decimal,
    months: int,
    expected_quota: Decimal,
) -> None:
    """Verifica el cálculo de cuotas mensuales francesas contra valores bancarios conocidos."""
    quota = calculate_french_monthly_payment(principal, tin_pct, months)
    assert quota == expected_quota


@pytest.mark.parametrize(
    ("principal", "tin_pct", "months"),
    [
        (Decimal("200000.00"), Decimal("3.40"), 360),
        (Decimal("220000.00"), Decimal("2.60"), 360),
        (Decimal("177777.77"), Decimal("2.87"), 313),
        (Decimal("95432.10"), Decimal("4.15"), 180),
    ],
)
def test_final_installment_cent_adjustment_and_zero_balance(
    principal: Decimal,
    tin_pct: Decimal,
    months: int,
) -> None:
    """
    Verifica que el ajuste de céntimos residuales en la última cuota deja el saldo
    final en 0.00 € exactos y que la suma de amortizaciones de capital coincide
    al céntimo con el principal del préstamo.
    """
    offer = MortgageOfferInput(
        principal_eur=principal,
        term_months=months,
        mortgage_type=MortgageType.FIXED,
        base_tin_pct=tin_pct,
        appraisal_cost_eur=ZERO,
    )
    res = generate_amortization_schedule(offer, accepted_product_ids=set())

    assert len(res.monthly_schedule) == months
    last_row = res.monthly_schedule[-1]
    assert last_row.remaining_balance_eur == Decimal("0.00")

    total_principal_amortized = sum((r.principal_eur for r in res.monthly_schedule), ZERO)
    assert total_principal_amortized == principal

    for row in res.monthly_schedule:
        assert row.monthly_payment_eur == row.interest_eur + row.principal_eur


def test_mixed_mortgage_tranche_switch_and_recalculation() -> None:
    """
    Verifica una hipoteca MIXTA (5 años fijos al 2.20% + 25 años variables a Euríbor 2.50% + 1.10% = 3.60%).
    Comprueba el cambio exacto de tipo y recálculo de cuota en el mes 61 sobre el saldo vivo del mes 60.
    """
    offer = MortgageOfferInput(
        offer_name="Mixta 5 Años",
        principal_eur=Decimal("250000.00"),
        term_months=360,
        mortgage_type=MortgageType.MIXED,
        base_tin_pct=Decimal("2.20"),
        fixed_years=5,
        euribor_pct=Decimal("2.50"),
        differential_pct=Decimal("1.10"),
        appraisal_cost_eur=ZERO,
    )

    res = generate_amortization_schedule(offer, accepted_product_ids=set())

    assert res.effective_initial_tin_pct == Decimal("2.2000")
    assert res.effective_variable_tin_pct == Decimal("3.6000")
    assert res.initial_monthly_payment_eur == Decimal("949.25")

    # Tramo fijo: meses 1 a 60
    for m in range(1, 61):
        row = res.monthly_schedule[m - 1]
        assert row.applied_tin_pct == Decimal("2.2000")
        assert row.monthly_payment_eur == Decimal("949.25")

    balance_after_month_60 = res.monthly_schedule[59].remaining_balance_eur
    expected_new_quota = calculate_french_monthly_payment(
        balance_after_month_60, Decimal("3.60"), 300
    )
    assert res.variable_monthly_payment_eur == expected_new_quota

    # Tramo variable: mes 61 en adelante
    row_61 = res.monthly_schedule[60]
    assert row_61.month == 61
    assert row_61.applied_tin_pct == Decimal("3.6000")
    assert row_61.monthly_payment_eur == expected_new_quota

    # Saldo final 0.00 exacto y suma de principal == 250,000.00 €
    assert res.monthly_schedule[-1].remaining_balance_eur == Decimal("0.00")
    assert sum((r.principal_eur for r in res.monthly_schedule), ZERO) == Decimal("250000.00")


def test_variable_mortgage_and_tin_floor_protection() -> None:
    """Verifica hipoteca VARIABLE (Euríbor + diferencial - bonificación) y respeto del suelo mínimo."""
    offer = MortgageOfferInput(
        principal_eur=Decimal("180000.00"),
        term_months=240,
        mortgage_type=MortgageType.VARIABLE,
        base_tin_pct=Decimal("3.00"),
        euribor_pct=Decimal("2.10"),
        differential_pct=Decimal("0.90"),
        min_tin_floor_pct=Decimal("1.00"),
        linked_products=[
            LinkedProduct(
                id="super_bonus",
                name="Bonificación Extrema",
                category=LinkedProductCategory.PAYROLL,
                bonus_pct=Decimal("-2.50"),
                annual_bank_cost_eur=ZERO,
            )
        ],
    )

    # Sin bonificar: 2.10 + 0.90 = 3.00%
    init_unbonified, var_unbonified = resolve_effective_tins(offer, ZERO)
    assert init_unbonified == Decimal("3.0000")
    assert var_unbonified == Decimal("3.0000")

    # Con bonificación de 2.50 pp: 3.00 - 2.50 = 0.50%, pero aplica suelo min_tin_floor_pct = 1.00%
    init_bonified, var_bonified = resolve_effective_tins(offer, Decimal("2.50"))
    assert init_bonified == Decimal("1.0000")
    assert var_bonified == Decimal("1.0000")


def test_linked_product_annual_compounding_and_exact_12_month_distribution() -> None:
    """
    Verifica que un producto cuyo coste anual no es divisible entre 12 (ej. 200.00 €/año)
    y que sube con IPC (2%) + edad (3%) suma en cada año exactamente la prima anual proyectada.
    """
    prod = LinkedProduct(
        id="vida",
        name="Seguro de Vida",
        category=LinkedProductCategory.LIFE_INSURANCE,
        bonus_pct=Decimal("-0.25"),
        annual_bank_cost_eur=Decimal("200.00"),
        annual_market_cost_eur=Decimal("100.00"),
        apply_ipc=True,
        annual_age_increase_pct=Decimal("3.00"),
    )

    bank_vec, market_vec = build_product_monthly_cost_vectors(
        product=prod,
        term_months=36,
        estimated_ipc_pct=Decimal("2.00"),
    )

    # Año 1 (crecimiento 0%): suma de los primeros 12 meses debe ser exactamente 200.00 € y 100.00 €
    assert sum(bank_vec[0:12], ZERO) == Decimal("200.00")
    assert sum(market_vec[0:12], ZERO) == Decimal("100.00")

    # Año 2 (crecimiento 5% = 2% IPC + 3% edad): 210.00 € y 105.00 €
    assert sum(bank_vec[12:24], ZERO) == Decimal("210.00")
    assert sum(market_vec[12:24], ZERO) == Decimal("105.00")

    # Año 3 (crecimiento compuesto 1.05^2 = 1.1025): 220.50 € y 110.25 €
    assert sum(bank_vec[24:36], ZERO) == Decimal("220.50")
    assert sum(market_vec[24:36], ZERO) == Decimal("110.25")
