"""
Módulo de aritmética financiera exacta para HipoReal.

Regla estricta:
- Prohibido el uso de `float` para importes monetarios, tipos de interés o cuotas.
- Redondeo bancario / financiero estándar `ROUND_HALF_UP` a 2 decimales para moneda
  y 4 decimales para tipos porcentuales (TIN / TAE).
"""

from decimal import Decimal, ROUND_HALF_UP

CENT = Decimal("0.01")
RATE_PRECISION = Decimal("0.0001")
ZERO = Decimal("0.00")
ONE = Decimal("1")
TWELVE = Decimal("12")
HUNDRED = Decimal("100")
MONTHS_PER_YEAR = 12


def ensure_decimal(value: Decimal | int | str) -> Decimal:
    """
    Convierte un valor a `Decimal` rechazando explícitamente instancias de `float`
    para evitar errores de coma flotante IEEE 754.
    """
    if isinstance(value, float):
        raise TypeError(
            "El uso de 'float' está prohibido en el motor financiero de HipoReal. "
            "Utilice 'Decimal' o 'str'."
        )
    if isinstance(value, Decimal):
        return value
    if isinstance(value, (int, str)):
        return Decimal(str(value))
    raise TypeError(f"Tipo numérico no soportado para cálculo financiero: {type(value)!r}")


def round_currency(value: Decimal) -> Decimal:
    """Redondea un importe en euros a 2 decimales con ROUND_HALF_UP."""
    if isinstance(value, float):
        raise TypeError("No se permite redondear un float; use Decimal.")
    result = value.quantize(CENT, rounding=ROUND_HALF_UP)
    # Evitar "-0.00" en representación Decimal
    return ZERO if result == ZERO else result


def round_rate(value: Decimal) -> Decimal:
    """Redondea un tipo de interés expresado en porcentaje (ej. 3.4512) a 4 decimales."""
    if isinstance(value, float):
        raise TypeError("No se permite redondear un float; use Decimal.")
    result = value.quantize(RATE_PRECISION, rounding=ROUND_HALF_UP)
    return Decimal("0.0000") if result == Decimal("0.0000") else result


def round_rate_2(value: Decimal) -> Decimal:
    """Redondea un porcentaje o ratio a 2 decimales con ROUND_HALF_UP."""
    if isinstance(value, float):
        raise TypeError("No se permite redondear un float; use Decimal.")
    result = value.quantize(CENT, rounding=ROUND_HALF_UP)
    return ZERO if result == ZERO else result


def annual_pct_to_monthly_rate(tin_pct: Decimal) -> Decimal:
    """
    Convierte un TIN anual en porcentaje (ej. Decimal('3.40'))
    a tipo de interés mensual en tanto por uno: TIN / 100 / 12.
    Mantiene toda la precisión del contexto Decimal (28 dígitos significativos).
    """
    tin = ensure_decimal(tin_pct)
    return (tin / HUNDRED) / TWELVE


def pct_to_ratio(pct: Decimal) -> Decimal:
    """Convierte un porcentaje (ej. Decimal('2.50')) a tanto por uno (Decimal('0.025'))."""
    return ensure_decimal(pct) / HUNDRED
