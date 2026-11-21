"""
Calculador de TAE Real Oculta (TIR / IRR) para HipoReal.

Implementa el cálculo de la Tasa Anual Equivalente (TAE) conforme a la matemática
financiera del Banco de España (Ley 5/2019 LCCI) sobre flujos de caja mensuales reales:
    CF_0 = Capital recibido neto de gastos iniciales (Principal - Comisión Apertura - Tasación - Otros)
    CF_m = Cuota mensual hipotecaria + Coste mensualizado de vinculaciones (para m = 1..N)

Ecuación de equivalencia financiera:
    CF_0 = sum_{m=1}^{N} CF_m * (1 + i_m)^(-m)

Resolución numérica en aritmética `Decimal` pura:
- Método primario: Newton-Raphson amortiguado con horquilla activa.
- Fallback garantizado: Bisección en intervalo acotado [r_low, r_high].
- Anualización compuesta: TAE (%) = ((1 + i_m)^12 - 1) * 100.
"""

from decimal import Decimal

from app.domain.money import HUNDRED, MONTHS_PER_YEAR, ONE, ZERO, ensure_decimal, round_rate

DEFAULT_TOLERANCE = Decimal("1E-11")
RATE_STEP_TOLERANCE = Decimal("1E-14")
MIN_MONTHLY_RATE = Decimal("-0.05")
INITIAL_HIGH_MONTHLY_RATE = Decimal("0.05")  # ~79.5% TAE anual inicial; se expande si es necesario


def evaluate_npv_and_derivative(
    net_initial_inflow_eur: Decimal,
    monthly_outflows_eur: list[Decimal],
    monthly_rate: Decimal,
) -> tuple[Decimal, Decimal]:
    """
    Evalúa la función de Valor Actual Neto f(r) y su derivada f'(r) respecto al
    tipo mensual r en una única pasada O(N) utilizando aritmética `Decimal`:
        f(r)  = sum_{m=1}^N O_m * (1 + r)^(-m) - CF_0
        f'(r) = -sum_{m=1}^N m * O_m * (1 + r)^(-(m + 1))
    """
    if monthly_rate <= -ONE:
        raise ValueError("El tipo de descuento mensual debe ser mayor que -1 (-100%).")

    u = ONE / (ONE + monthly_rate)
    discount = u
    pv_sum = ZERO
    deriv_sum = ZERO

    for m_idx, outflow in enumerate(monthly_outflows_eur, start=1):
        term = outflow * discount
        pv_sum += term
        deriv_sum -= Decimal(m_idx) * term * u
        discount *= u

    npv = pv_sum - net_initial_inflow_eur
    return npv, deriv_sum


def _find_bracket(
    net_initial_inflow_eur: Decimal,
    monthly_outflows_eur: list[Decimal],
) -> tuple[Decimal, Decimal]:
    """
    Encuentra un intervalo [r_low, r_high] tal que f(r_low) >= 0 y f(r_high) <= 0.
    """
    total_outflows = sum(monthly_outflows_eur, ZERO)

    if total_outflows >= net_initial_inflow_eur:
        r_low = ZERO
    else:
        r_low = MIN_MONTHLY_RATE
        npv_low, _ = evaluate_npv_and_derivative(net_initial_inflow_eur, monthly_outflows_eur, r_low)
        while npv_low < ZERO and r_low > Decimal("-0.50"):
            r_low *= Decimal("2")
            npv_low, _ = evaluate_npv_and_derivative(net_initial_inflow_eur, monthly_outflows_eur, r_low)

    r_high = INITIAL_HIGH_MONTHLY_RATE
    npv_high, _ = evaluate_npv_and_derivative(net_initial_inflow_eur, monthly_outflows_eur, r_high)
    while npv_high > ZERO and r_high < Decimal("10.0"):
        r_high *= Decimal("2")
        npv_high, _ = evaluate_npv_and_derivative(net_initial_inflow_eur, monthly_outflows_eur, r_high)

    return r_low, r_high


def solve_monthly_irr_bisection(
    net_initial_inflow_eur: Decimal,
    monthly_outflows_eur: list[Decimal],
    low: Decimal | None = None,
    high: Decimal | None = None,
    tolerance: Decimal = DEFAULT_TOLERANCE,
    max_iterations: int = 120,
) -> Decimal:
    """
    Resuelve la TIR mensual mediante el método de Bisección puro en `Decimal`.
    Se utiliza tanto como fallback automático de Newton-Raphson como para verificación en tests.
    """
    inflow = ensure_decimal(net_initial_inflow_eur)
    if inflow <= ZERO:
        raise ValueError("El capital neto recibido inicial debe ser estrictamente positivo.")
    if not monthly_outflows_eur:
        raise ValueError("La serie de flujos mensuales no puede estar vacía.")

    outflows = [ensure_decimal(x) for x in monthly_outflows_eur]
    total_outflows = sum(outflows, ZERO)
    if total_outflows == inflow:
        return ZERO

    r_low, r_high = (low, high) if (low is not None and high is not None) else _find_bracket(inflow, outflows)
    two = Decimal("2")

    mid = (r_low + r_high) / two
    for _ in range(max_iterations):
        mid = (r_low + r_high) / two
        npv_mid, _ = evaluate_npv_and_derivative(inflow, outflows, mid)

        if abs(npv_mid) <= tolerance or abs(r_high - r_low) <= RATE_STEP_TOLERANCE:
            return mid

        if npv_mid > ZERO:
            r_low = mid
        else:
            r_high = mid

    return mid


def solve_monthly_irr(
    net_initial_inflow_eur: Decimal,
    monthly_outflows_eur: list[Decimal],
    initial_guess: Decimal = Decimal("0.0025"),
    tolerance: Decimal = DEFAULT_TOLERANCE,
    max_newton_iterations: int = 35,
) -> Decimal:
    """
    Calcula la TIR mensual `i_m` mediante Newton-Raphson con horquilla de seguridad
    y fallback automático a Bisección si la derivada se anula, el paso sale del intervalo
    acotado o no converge en `max_newton_iterations`.
    """
    inflow = ensure_decimal(net_initial_inflow_eur)
    if inflow <= ZERO:
        raise ValueError("El capital neto recibido inicial debe ser estrictamente positivo.")
    if not monthly_outflows_eur:
        raise ValueError("La serie de flujos mensuales no puede estar vacía.")

    outflows = [ensure_decimal(x) for x in monthly_outflows_eur]
    total_outflows = sum(outflows, ZERO)
    if total_outflows <= ZERO:
        raise ValueError("La suma de flujos de salida mensuales debe ser positiva.")
    if total_outflows == inflow:
        return ZERO

    r_low, r_high = _find_bracket(inflow, outflows)
    two = Decimal("2")

    r = ensure_decimal(initial_guess)
    if not (r_low < r < r_high):
        r = (r_low + r_high) / two

    for _ in range(max_newton_iterations):
        npv, d_npv = evaluate_npv_and_derivative(inflow, outflows, r)

        if abs(npv) <= tolerance or abs(r_high - r_low) <= RATE_STEP_TOLERANCE:
            return r

        # Actualizar horquilla [r_low, r_high] aprovechando la monotonía estricta de f(r)
        if npv > ZERO:
            r_low = r
        else:
            r_high = r

        # Calcular paso de Newton-Raphson; si sale de la horquilla o d_npv == 0, usar bisección
        if d_npv == ZERO:
            r_next = (r_low + r_high) / two
        else:
            newton_step = npv / d_npv
            r_candidate = r - newton_step
            if r_low < r_candidate < r_high:
                r_next = r_candidate
            else:
                r_next = (r_low + r_high) / two

        if abs(r_next - r) <= RATE_STEP_TOLERANCE:
            return r_next

        r = r_next

    # Fallback completo a bisección en el intervalo estrechado [r_low, r_high]
    return solve_monthly_irr_bisection(
        net_initial_inflow_eur=inflow,
        monthly_outflows_eur=outflows,
        low=r_low,
        high=r_high,
        tolerance=tolerance,
    )


def monthly_irr_to_annual_tae_pct(monthly_irr: Decimal) -> Decimal:
    """
    Convierte una TIR mensual en tanto por uno a TAE anual en porcentaje:
        TAE (%) = ((1 + i_m)^12 - 1) * 100
    Redondea a 4 decimales con ROUND_HALF_UP.
    """
    r_m = ensure_decimal(monthly_irr)
    annual_effective_ratio = ((ONE + r_m) ** MONTHS_PER_YEAR) - ONE
    return round_rate(annual_effective_ratio * HUNDRED)


def calculate_tae_pct(
    net_initial_inflow_eur: Decimal,
    monthly_outflows_eur: list[Decimal],
) -> Decimal:
    """
    Calcula la TAE Real (%) a partir del capital neto inicial recibido en t=0
    y la lista de desembolsos mensuales reales para m=1..N.
    """
    monthly_irr = solve_monthly_irr(net_initial_inflow_eur, monthly_outflows_eur)
    return monthly_irr_to_annual_tae_pct(monthly_irr)
