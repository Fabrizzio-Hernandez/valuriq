"""
Modelos de dominio e invariantes financieras de HipoReal.

Arquitectura Limpia:
- Este módulo pertenece a `/backend/app/domain/`.
- No tiene ninguna dependencia de FastAPI ni de SQLAlchemy.
- Todos los importes monetarios y tipos de interés usan `decimal.Decimal`.
"""

from decimal import Decimal
from enum import Enum
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.domain.money import ZERO, round_currency, round_rate


def _validate_no_float(value: object) -> Decimal:
    """
    Valida y convierte entradas numéricas a Decimal sin pérdida de precisión.
    Si recibe un float de Python directamente en código, lo rechaza para hacer
    cumplir la regla estricta de usar Decimal/str/int.
    """
    if isinstance(value, float):
        raise ValueError(
            "Prohibido usar 'float' para importes monetarios o tipos de interés. "
            "Use 'Decimal' o 'str'."
        )
    if isinstance(value, Decimal):
        return value
    if isinstance(value, (int, str)):
        return Decimal(str(value))
    raise ValueError(f"Valor numérico inválido: {value!r}")


StrictDecimal = Annotated[Decimal, Field()]


class MortgageType(str, Enum):
    """Tipos de hipoteca del mercado español con sistema de amortización francés."""

    FIXED = "FIXED"
    MIXED = "MIXED"
    VARIABLE = "VARIABLE"


class LinkedProductCategory(str, Enum):
    """Categorías estándar de productos vinculados en banca española."""

    PAYROLL = "PAYROLL"
    HOME_INSURANCE = "HOME_INSURANCE"
    LIFE_INSURANCE = "LIFE_INSURANCE"
    ALARM = "ALARM"
    CREDIT_CARD = "CREDIT_CARD"
    PENSION_PLAN = "PENSION_PLAN"
    INVESTMENT_FUND = "INVESTMENT_FUND"
    OTHER = "OTHER"


class LinkedProductPaymentMode(str, Enum):
    """Modalidad de pago del producto vinculado: prima anual renovable o Prima Única Financiada (PUF)."""

    ANNUAL = "ANNUAL"
    PUF_FINANCED = "PUF_FINANCED"


class LinkedProduct(BaseModel):
    """
    Producto vinculado ofertado por el banco para bonificar el TIN.

    - `bonus_pct`: Puntos porcentuales de descuento en el TIN (ej. 0.30 o -0.30 -> 0.30%).
    - `annual_bank_cost_eur`: Coste anual si se contrata con el banco (Año 1).
    - `annual_market_cost_eur`: Coste anual de un producto equivalente en el mercado libre
      (0.00 € si el usuario no lo necesita ni lo contrataría por su cuenta, como una alarma).
    - `apply_ipc`: Si el coste anual se revaloriza anualmente según el IPC estimado.
    - `annual_age_increase_pct`: Incremento anual porcentual adicional por edad (típico del seguro de vida).
    - `payment_mode`: `ANNUAL` (prima anual) o `PUF_FINANCED` (Prima Única Financiada sumada al principal en t=0).
    - `puf_amount_eur`: Importe único financiado en t=0 cuando `payment_mode == 'PUF_FINANCED'`.
    - `puf_coverage_years`: Años cubiertos por la prima única financiada (ej. 10 o 15 años).
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: str = Field(..., min_length=1, max_length=64, description="Identificador único del producto vinculado")
    name: str = Field(..., min_length=1, max_length=120, description="Nombre descriptivo del producto vinculado")
    category: LinkedProductCategory = Field(
        default=LinkedProductCategory.OTHER,
        description="Categoría del producto vinculado",
    )
    bonus_pct: Decimal = Field(
        ...,
        description="Bonificación en puntos porcentuales sobre el TIN (ej. 0.30 o -0.30 para rebajar 0.30%)",
    )
    annual_bank_cost_eur: Decimal = Field(
        default=ZERO,
        ge=ZERO,
        description="Coste anual contratado con el banco en euros (Año 1)",
    )
    annual_market_cost_eur: Decimal = Field(
        default=ZERO,
        ge=ZERO,
        description="Coste anual equivalente en el mercado libre en euros (0 € si es prescindible)",
    )
    apply_ipc: bool = Field(
        default=False,
        description="Indica si el coste del producto se actualiza anualmente con el IPC",
    )
    annual_age_increase_pct: Decimal = Field(
        default=ZERO,
        ge=ZERO,
        le=Decimal("50.00"),
        description="Incremento anual adicional en % por tramo de edad (ej. seguro de vida: 3.50%)",
    )
    payment_mode: LinkedProductPaymentMode = Field(
        default=LinkedProductPaymentMode.ANNUAL,
        description="Modalidad de cobro: ANNUAL (anual) o PUF_FINANCED (Prima Única Financiada en el préstamo)",
    )
    puf_amount_eur: Decimal = Field(
        default=ZERO,
        ge=ZERO,
        le=Decimal("500000.00"),
        description="Importe de la Prima Única Financiada (PUF) sumado al capital en t=0 (€)",
    )
    puf_coverage_years: int = Field(
        default=10,
        ge=1,
        le=50,
        description="Número de años de cobertura incluidos en la Prima Única Financiada",
    )

    @field_validator(
        "bonus_pct",
        "annual_bank_cost_eur",
        "annual_market_cost_eur",
        "annual_age_increase_pct",
        "puf_amount_eur",
        mode="before",
    )
    @classmethod
    def _parse_decimal_fields(cls, v: object) -> Decimal:
        return _validate_no_float(v)

    @field_validator("bonus_pct", mode="after")
    @classmethod
    def _normalize_bonus_pct(cls, v: Decimal) -> Decimal:
        """
        Normaliza la bonificación a valor positivo en puntos porcentuales.
        Tanto -0.30 como 0.30 representan 0.30 puntos porcentuales de descuento en el TIN.
        """
        normalized = abs(v)
        if normalized > Decimal("10.00"):
            raise ValueError("La bonificación de un producto vinculado no puede superar 10.00 puntos porcentuales.")
        return round_rate(normalized)

    @field_validator("annual_bank_cost_eur", "annual_market_cost_eur", "puf_amount_eur", mode="after")
    @classmethod
    def _quantize_currency_fields(cls, v: Decimal) -> Decimal:
        return round_currency(v)

    @field_validator("annual_age_increase_pct", mode="after")
    @classmethod
    def _quantize_rate_fields(cls, v: Decimal) -> Decimal:
        return round_rate(v)

    @model_validator(mode="after")
    def _validate_puf_invariants(self) -> "LinkedProduct":
        if self.payment_mode == LinkedProductPaymentMode.PUF_FINANCED and self.puf_amount_eur <= ZERO:
            raise ValueError(
                f"El producto '{self.name}' con modalidad 'PUF_FINANCED' requiere 'puf_amount_eur' > 0."
            )
        return self


class MortgageOfferInput(BaseModel):
    """
    Datos de entrada de una oferta hipotecaria real a auditar.
    Soporta modalidad Fija, Mixta y Variable con sistema de amortización francés.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    offer_name: str = Field(
        default="Oferta Hipotecaria",
        min_length=1,
        max_length=140,
        description="Nombre identificativo de la oferta o simulación",
    )
    bank_name: str = Field(
        default="Entidad Bancaria",
        min_length=1,
        max_length=100,
        description="Nombre del banco o entidad financiera",
    )
    principal_eur: Decimal = Field(
        ...,
        gt=ZERO,
        le=Decimal("10000000.00"),
        description="Capital del préstamo hipotecario (principal) en euros",
    )
    term_months: int = Field(
        ...,
        ge=12,
        le=600,
        description="Plazo total del préstamo en meses (ej. 360 para 30 años)",
    )
    mortgage_type: MortgageType = Field(
        default=MortgageType.FIXED,
        description="Modalidad de la hipoteca: FIXED (Fija), MIXED (Mixta) o VARIABLE (Variable)",
    )
    base_tin_pct: Decimal = Field(
        ...,
        ge=ZERO,
        le=Decimal("30.00"),
        description="TIN nominal anual base sin bonificar (%) para hipoteca Fija o tramo fijo de Mixta",
    )
    fixed_years: int = Field(
        default=0,
        ge=0,
        le=50,
        description="Número de años del tramo fijo inicial (obligatorio > 0 en hipoteca MIXED)",
    )
    euribor_pct: Decimal = Field(
        default=Decimal("2.50"),
        ge=Decimal("-5.00"),
        le=Decimal("25.00"),
        description="Euríbor estimado (%) aplicable al tramo variable en MIXED o VARIABLE",
    )
    differential_pct: Decimal = Field(
        default=Decimal("1.00"),
        ge=ZERO,
        le=Decimal("20.00"),
        description="Diferencial base sin bonificar (%) sobre Euríbor en MIXED o VARIABLE",
    )
    min_tin_floor_pct: Decimal = Field(
        default=ZERO,
        ge=ZERO,
        le=Decimal("10.00"),
        description="Suelo mínimo del TIN (%) tras aplicar bonificaciones (por defecto 0.00%)",
    )
    opening_commission_pct: Decimal = Field(
        default=ZERO,
        ge=ZERO,
        le=Decimal("10.00"),
        description="Comisión de apertura (%) sobre el capital prestado",
    )
    appraisal_cost_eur: Decimal = Field(
        default=Decimal("400.00"),
        ge=ZERO,
        description="Coste de tasación oficial del inmueble en euros",
    )
    other_initial_expenses_eur: Decimal = Field(
        default=ZERO,
        ge=ZERO,
        description="Otros gastos iniciales a cargo del prestatario (ej. nota simple, comisión estudio) en euros",
    )
    estimated_ipc_pct: Decimal = Field(
        default=Decimal("2.00"),
        ge=ZERO,
        le=Decimal("25.00"),
        description="IPC anual estimado (%) para actualizar productos vinculados sujetos a inflación",
    )
    linked_products: list[LinkedProduct] = Field(
        default_factory=list,
        max_length=12,
        description="Catálogo de productos vinculados asociados a la oferta (máximo 12 para proteger 2^N = 4.096)",
    )

    @field_validator(
        "principal_eur",
        "base_tin_pct",
        "euribor_pct",
        "differential_pct",
        "min_tin_floor_pct",
        "opening_commission_pct",
        "appraisal_cost_eur",
        "other_initial_expenses_eur",
        "estimated_ipc_pct",
        mode="before",
    )
    @classmethod
    def _parse_decimals(cls, v: object) -> Decimal:
        return _validate_no_float(v)

    @field_validator("principal_eur", "appraisal_cost_eur", "other_initial_expenses_eur", mode="after")
    @classmethod
    def _quantize_money(cls, v: Decimal) -> Decimal:
        return round_currency(v)

    @field_validator(
        "base_tin_pct",
        "euribor_pct",
        "differential_pct",
        "min_tin_floor_pct",
        "opening_commission_pct",
        "estimated_ipc_pct",
        mode="after",
    )
    @classmethod
    def _quantize_rates(cls, v: Decimal) -> Decimal:
        return round_rate(v)

    @model_validator(mode="after")
    def _validate_mortgage_invariants(self) -> "MortgageOfferInput":
        if self.mortgage_type == MortgageType.MIXED:
            if self.fixed_years <= 0:
                raise ValueError("Una hipoteca MIXED (Mixta) requiere 'fixed_years' > 0.")
            if self.fixed_years * 12 >= self.term_months:
                raise ValueError(
                    f"El tramo fijo ({self.fixed_years * 12} meses) debe ser menor que el plazo total ({self.term_months} meses) en una hipoteca MIXED."
                )
        if self.net_received_capital_eur <= ZERO:
            raise ValueError(
                f"Los gastos iniciales totales ({self.total_initial_expenses_eur} €) no pueden igualar ni superar "
                f"el capital del préstamo ({self.principal_eur} €)."
            )
        # Verificar unicidad de IDs de productos vinculados
        seen_ids: set[str] = set()
        for prod in self.linked_products:
            if prod.id in seen_ids:
                raise ValueError(f"Identificador de producto vinculado duplicado: '{prod.id}'.")
            seen_ids.add(prod.id)
        return self

    @property
    def opening_commission_eur(self) -> Decimal:
        """Importe en euros de la comisión de apertura redondeado a céntimos."""
        return round_currency(self.principal_eur * (self.opening_commission_pct / Decimal("100")))

    @property
    def total_initial_expenses_eur(self) -> Decimal:
        """Gastos iniciales totales pagados en t=0 (comisión de apertura + tasación + otros)."""
        return round_currency(
            self.opening_commission_eur + self.appraisal_cost_eur + self.other_initial_expenses_eur
        )

    @property
    def net_received_capital_eur(self) -> Decimal:
        """Capital neto recibido en t=0 una vez descontados los gastos iniciales."""
        return round_currency(self.principal_eur - self.total_initial_expenses_eur)


class AmortizationRow(BaseModel):
    """Fila mensual del cuadro de amortización francés enriquecida con costes de vinculaciones."""

    model_config = ConfigDict(frozen=True)

    month: int = Field(..., ge=1, description="Número de mes (1..N)")
    year: int = Field(..., ge=1, description="Número de año (1..Y)")
    applied_tin_pct: Decimal = Field(..., description="TIN nominal anual aplicado en este mes (%)")
    monthly_payment_eur: Decimal = Field(..., description="Cuota mensual hipotecaria (intereses + capital amortizado)")
    interest_eur: Decimal = Field(..., description="Intereses pagados en este mes")
    principal_eur: Decimal = Field(..., description="Capital amortizado en este mes")
    remaining_balance_eur: Decimal = Field(..., description="Saldo de capital pendiente tras el pago del mes")
    linked_bank_cost_eur: Decimal = Field(
        default=ZERO,
        description="Coste mensualizado de las vinculaciones aceptadas con el banco",
    )
    linked_market_cost_eur: Decimal = Field(
        default=ZERO,
        description="Coste mensualizado de los seguros/productos contratados en el mercado libre",
    )
    linked_total_cost_eur: Decimal = Field(
        default=ZERO,
        description="Coste mensual total en productos/seguros (banco + mercado libre)",
    )
    linked_overcost_eur: Decimal = Field(
        default=ZERO,
        description="Sobrecoste mensual neto de las vinculaciones aceptadas frente al mercado libre",
    )
    total_monthly_outflow_eur: Decimal = Field(
        ...,
        description="Desembolso mensual total del prestatario (cuota hipotecaria + vinculaciones del escenario)",
    )


class YearlySummaryRow(BaseModel):
    """Resumen anual y curvas de coste acumulado año a año para gráficas y punto de equilibrio."""

    model_config = ConfigDict(frozen=True)

    year: int = Field(..., ge=1, description="Año del préstamo (1..Y)")
    applied_tin_pct: Decimal = Field(..., description="TIN nominal aplicado al cierre del año (%)")
    mortgage_payments_eur: Decimal = Field(..., description="Suma de cuotas hipotecarias pagadas en el año")
    interest_paid_eur: Decimal = Field(..., description="Suma de intereses pagados en el año")
    principal_paid_eur: Decimal = Field(..., description="Suma de capital amortizado en el año")
    ending_balance_eur: Decimal = Field(..., description="Saldo pendiente al finalizar el año")
    linked_bank_cost_eur: Decimal = Field(..., description="Coste anual pagado al banco en vinculaciones")
    linked_market_cost_eur: Decimal = Field(..., description="Coste anual pagado en mercado libre en seguros externos")
    linked_total_cost_eur: Decimal = Field(..., description="Coste anual total en productos/seguros del escenario")
    linked_overcost_eur: Decimal = Field(..., description="Sobrecoste anual de vinculaciones respecto al mercado libre")
    annual_total_outflow_eur: Decimal = Field(..., description="Desembolso total del año (cuotas + vinculaciones)")
    cumulative_mortgage_outflow_eur: Decimal = Field(..., description="Cuotas hipotecarias acumuladas hasta este año")
    cumulative_interest_paid_eur: Decimal = Field(..., description="Intereses acumulados hasta este año")
    cumulative_linked_cost_eur: Decimal = Field(..., description="Coste en productos/vinculaciones acumulado hasta este año")
    cumulative_linked_overcost_eur: Decimal = Field(..., description="Sobrecoste de vinculaciones acumulado hasta este año")
    cumulative_total_outflow_eur: Decimal = Field(
        ...,
        description="Desembolso total real acumulado hasta este año (gastos iniciales + cuotas + vinculaciones)",
    )


class CombinationEvaluation(BaseModel):
    """
    Resultado financiero completo de evaluar una combinación específica de vinculaciones
    dentro del espacio combinatorio 2^N.
    """

    model_config = ConfigDict(frozen=True)

    combination_id: str = Field(..., description="Identificador binario/semántico de la combinación (ej. '0101')")
    rank: int = Field(default=1, ge=1, description="Posición en el ranking ordenado por menor coste total real")
    accepted_product_ids: list[str] = Field(default_factory=list, description="IDs de vinculaciones aceptadas con el banco")
    rejected_product_ids: list[str] = Field(default_factory=list, description="IDs de vinculaciones rechazadas del banco")
    accepted_product_names: list[str] = Field(default_factory=list, description="Nombres de vinculaciones aceptadas")
    rejected_product_names: list[str] = Field(default_factory=list, description="Nombres de vinculaciones rechazadas")
    total_bonus_pct: Decimal = Field(..., description="Bonificación total aplicada al TIN (puntos porcentuales)")
    effective_initial_tin_pct: Decimal = Field(..., description="TIN efectivo inicial o fijo (%)")
    effective_variable_tin_pct: Decimal = Field(..., description="TIN efectivo del tramo variable (%)")
    initial_monthly_payment_eur: Decimal = Field(..., description="Cuota mensual hipotecaria inicial (solo préstamo)")
    variable_monthly_payment_eur: Decimal = Field(..., description="Cuota mensual hipotecaria del tramo variable")
    initial_total_monthly_outflow_eur: Decimal = Field(
        ...,
        description="Desembolso mensual real en el Año 1 (cuota hipotecaria + coste mensual de vinculaciones)",
    )
    principal_eur: Decimal = Field(..., description="Capital prestado de la vivienda (principal base)")
    financed_principal_eur: Decimal = Field(
        default=ZERO,
        description="Capital total financiado en t=0 (principal vivienda + primas únicas financiadas PUF aceptadas)",
    )
    puf_financed_amount_eur: Decimal = Field(
        default=ZERO,
        description="Importe total de Primas Únicas Financiadas (PUF) sumado al capital del préstamo en t=0",
    )
    puf_extra_interest_eur: Decimal = Field(
        default=ZERO,
        description="Intereses compuestos extra generados exclusivamente por financiar seguros PUF dentro de la hipoteca",
    )
    initial_expenses_eur: Decimal = Field(..., description="Gastos iniciales (comisión apertura + tasación + otros)")
    total_interest_eur: Decimal = Field(..., description="Total de intereses pagados en toda la vida del préstamo")
    total_mortgage_payments_eur: Decimal = Field(..., description="Suma total de cuotas hipotecarias (capital + intereses)")
    total_linked_bank_cost_eur: Decimal = Field(..., description="Total pagado al banco por vinculaciones aceptadas")
    total_linked_market_cost_eur: Decimal = Field(..., description="Total pagado en mercado libre por productos externos")
    total_linked_cost_eur: Decimal = Field(..., description="Coste total en productos/seguros del escenario")
    total_linked_overcost_eur: Decimal = Field(
        ...,
        description="Sobrecoste total neto pagado al banco frente al mercado libre en las vinculaciones aceptadas",
    )
    total_cost_eur: Decimal = Field(
        ...,
        description="Desembolso Total Real a lo largo de la vida del préstamo (gastos iniciales + cuotas + vinculaciones)",
    )
    tae_real_pct: Decimal = Field(
        ...,
        description="TAE Real Oculta (%) calculada por TIR mensual sobre el flujo neto recibido y desembolsos totales",
    )
    tae_overcost_pct: Decimal = Field(
        ...,
        description="TAE Real por Sobrecoste (%) imputando únicamente el sobrecoste de vinculaciones frente al mercado libre",
    )
    nominal_tae_pct: Decimal = Field(
        ...,
        description="TAE hipotecaria pura (%) sin vinculaciones (solo cuotas y gastos iniciales)",
    )
    savings_vs_all_bonified_eur: Decimal = Field(
        default=ZERO,
        description="Ahorro neto en euros frente al Escenario A (100% bonificada con el banco)",
    )
    savings_vs_unbonified_eur: Decimal = Field(
        default=ZERO,
        description="Ahorro neto en euros frente al Escenario B (sin vinculaciones con el banco)",
    )
    break_even_year_vs_all_bonified: int | None = Field(
        default=None,
        description="Año a partir del cual esta combinación es más rentable que el Escenario A (punto de equilibrio)",
    )
    crossover_year_vs_all_bonified: int | None = Field(
        default=None,
        description="Año exacto en que se cruzan las curvas de coste acumulado con el Escenario A (None si no hay cruce)",
    )
    yearly_summary: list[YearlySummaryRow] = Field(
        default_factory=list,
        description="Curva anual de amortización y costes acumulados año a año",
    )
    monthly_schedule: list[AmortizationRow] = Field(
        default_factory=list,
        description="Cuadro de amortización mensual completo (incluido en los escenarios principales A, B y C)",
    )


class OptimizationVerdict(BaseModel):
    """Veredicto ejecutivo generado por el Optimizador Combinatorio 2^N."""

    model_config = ConfigDict(frozen=True)

    headline: str = Field(..., description="Titular directo de recomendación financiera y ahorro neto")
    explanation: str = Field(..., description="Explicación detallada del análisis combinatorio y la TAE Real Oculta")
    optimal_matches_all_bonified: bool = Field(
        ...,
        description="True si el óptimo matemático coincide con aceptar todas las vinculaciones (Escenario A)",
    )
    optimal_matches_unbonified: bool = Field(
        ...,
        description="True si el óptimo matemático coincide con rechazar todas las vinculaciones (Escenario B)",
    )
    net_savings_vs_all_bonified_eur: Decimal = Field(
        ...,
        description="Ahorro neto del Escenario C (Óptimo) frente al Escenario A (Todo bonificado)",
    )
    net_savings_vs_unbonified_eur: Decimal = Field(
        ...,
        description="Ahorro neto del Escenario C (Óptimo) frente al Escenario B (Sin bonificar)",
    )
    max_possible_savings_eur: Decimal = Field(
        ...,
        description="Ahorro neto del Escenario C frente a la peor combinación posible",
    )
    hidden_tae_spread_pct: Decimal = Field(
        ...,
        description="Diferencia en puntos porcentuales entre la TAE Real del Escenario A y su TIN bonificado",
    )
    break_even_year: int | None = Field(
        default=None,
        description="Año de punto de equilibrio del Escenario Óptimo frente al Escenario A (Todo bonificado)",
    )


class MortgageAuditResult(BaseModel):
    """Resultado integral de la auditoría hipotecaria y optimización combinatoria 2^N."""

    model_config = ConfigDict(frozen=True)

    offer: MortgageOfferInput = Field(..., description="Oferta hipotecaria auditada")
    total_combinations_evaluated: int = Field(..., ge=1, description="Número total de combinaciones evaluadas (2^N)")
    scenario_a_all_bonified: CombinationEvaluation = Field(
        ...,
        description="Escenario A: Hipoteca 100% bonificada (aceptando todas las vinculaciones del banco)",
    )
    scenario_b_unbonified: CombinationEvaluation = Field(
        ...,
        description="Escenario B: Hipoteca sin vinculaciones (interés base + seguros externos en mercado libre)",
    )
    scenario_c_optimal: CombinationEvaluation = Field(
        ...,
        description="Escenario C (Óptimo Matemático): Combinación exacta que minimiza el desembolso total real",
    )
    verdict: OptimizationVerdict = Field(..., description="Veredicto ejecutivo de la auditoría")
    ranking: list[CombinationEvaluation] = Field(
        ...,
        description="Ranking completo de las 2^N combinaciones ordenadas de menor a mayor coste total real",
    )


class EarlyRepaymentFrequency(str, Enum):
    """Modalidad temporal de la amortización anticipada."""

    ONE_OFF = "ONE_OFF"
    MONTHLY = "MONTHLY"
    ANNUAL = "ANNUAL"


class EarlyRepaymentStrategy(str, Enum):
    """Destino de la amortización anticipada parcial."""

    REDUCE_PAYMENT = "REDUCE_PAYMENT"
    REDUCE_TERM = "REDUCE_TERM"


class EarlyRepaymentConfig(BaseModel):
    """Configuración para simular amortizaciones anticipadas puntuales o periódicas."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    amount_eur: Decimal = Field(
        ...,
        gt=ZERO,
        le=Decimal("10000000.00"),
        description="Importe de cada aportación extraordinaria en euros",
    )
    frequency: EarlyRepaymentFrequency = Field(
        default=EarlyRepaymentFrequency.ONE_OFF,
        description="Frecuencia de la amortización: ONE_OFF (puntual), MONTHLY (mensual) o ANNUAL (anual)",
    )
    start_month: int = Field(
        default=12,
        ge=1,
        le=600,
        description="Mes del préstamo en el que se realiza la primera amortización anticipada (1..N)",
    )
    end_month: int | None = Field(
        default=None,
        ge=1,
        le=600,
        description="Mes final para amortizaciones periódicas (None = hasta el final del préstamo)",
    )
    commission_pct: Decimal = Field(
        default=ZERO,
        ge=ZERO,
        le=Decimal("5.00"),
        description="Comisión por amortización anticipada (%) según contrato / límites Ley 5/2019 LCCI",
    )

    @field_validator("amount_eur", "commission_pct", mode="before")
    @classmethod
    def _parse_decimals(cls, v: object) -> Decimal:
        return _validate_no_float(v)

    @field_validator("amount_eur", mode="after")
    @classmethod
    def _quantize_amount(cls, v: Decimal) -> Decimal:
        return round_currency(v)

    @field_validator("commission_pct", mode="after")
    @classmethod
    def _quantize_commission(cls, v: Decimal) -> Decimal:
        return round_rate(v)

    @model_validator(mode="after")
    def _validate_month_range(self) -> "EarlyRepaymentConfig":
        if self.end_month is not None and self.end_month < self.start_month:
            raise ValueError("'end_month' no puede ser anterior a 'start_month'.")
        return self


class EarlyRepaymentRow(BaseModel):
    """Fila mensual del cuadro de amortización con aportaciones anticipadas."""

    model_config = ConfigDict(frozen=True)

    month: int
    year: int
    applied_tin_pct: Decimal
    regular_payment_eur: Decimal
    interest_eur: Decimal
    regular_principal_eur: Decimal
    early_repayment_eur: Decimal
    commission_eur: Decimal
    total_month_outflow_eur: Decimal
    remaining_balance_eur: Decimal


class YearlyBalancePoint(BaseModel):
    """Punto anual de evolución de saldo e intereses acumulados para comparativa gráfica."""

    model_config = ConfigDict(frozen=True)

    year: int
    remaining_balance_eur: Decimal
    cumulative_interest_eur: Decimal
    cumulative_early_repaid_eur: Decimal


class EarlyRepaymentStrategyResult(BaseModel):
    """Resultado detallado de aplicar una estrategia de amortización anticipada (Cuota vs Plazo)."""

    model_config = ConfigDict(frozen=True)

    strategy: EarlyRepaymentStrategy
    original_term_months: int
    new_term_months: int
    months_saved: int
    years_saved: Decimal
    initial_monthly_payment_eur: Decimal
    monthly_payment_after_first_repayment_eur: Decimal
    final_regular_monthly_payment_eur: Decimal
    total_early_repaid_eur: Decimal
    total_commission_paid_eur: Decimal
    baseline_total_interest_eur: Decimal
    total_interest_paid_eur: Decimal
    gross_interest_saved_eur: Decimal
    net_savings_eur: Decimal
    yearly_curve: list[YearlyBalancePoint]
    schedule: list[EarlyRepaymentRow]


class EarlyRepaymentComparisonResult(BaseModel):
    """Comparativa completa Reducir Cuota vs Reducir Plazo ante amortizaciones anticipadas."""

    model_config = ConfigDict(frozen=True)

    config: EarlyRepaymentConfig
    principal_eur: Decimal
    baseline_term_months: int
    baseline_initial_payment_eur: Decimal
    baseline_total_interest_eur: Decimal
    reduce_payment: EarlyRepaymentStrategyResult
    reduce_term: EarlyRepaymentStrategyResult
    recommended_strategy: EarlyRepaymentStrategy
    extra_savings_reducing_term_eur: Decimal
    verdict_summary: str


class ProductYearlyBenefitPoint(BaseModel):
    """Punto anual del análisis marginal de un producto vinculado (ahorro en intereses vs sobrecoste del seguro)."""

    model_config = ConfigDict(frozen=True)

    year: int = Field(..., ge=1, description="Año del préstamo (1..Y)")
    remaining_balance_start_eur: Decimal = Field(..., description="Saldo vivo al inicio del año")
    interest_saved_by_bonus_eur: Decimal = Field(
        ...,
        description="Ahorro aproximado en intereses hipotecarios generado por la bonificación de este producto en el año",
    )
    bank_cost_eur: Decimal = Field(..., description="Coste anual del producto contratado con el banco")
    market_cost_eur: Decimal = Field(..., description="Coste anual equivalente en el mercado libre")
    annual_overcost_eur: Decimal = Field(
        ...,
        description="Sobrecoste neto anual del producto bancario frente al mercado libre",
    )
    net_annual_benefit_eur: Decimal = Field(
        ...,
        description="Beneficio neto anual de mantener la vinculación con el banco (ahorro intereses - sobrecoste)",
    )
    is_active_with_bank: bool = Field(
        ...,
        description="True si en este año la estrategia dinámica mantiene el producto activo con el banco",
    )


class ProductDynamicStrategy(BaseModel):
    """Recomendación temporal óptima de mantenimiento o cancelación por años para un producto vinculado."""

    model_config = ConfigDict(frozen=True)

    product_id: str
    product_name: str
    payment_mode: LinkedProductPaymentMode
    bonus_pct: Decimal
    keep_years: int = Field(
        ...,
        ge=0,
        description="Número de años que conviene mantener el producto con el banco (0 = rechazar día 1; Y = toda la hipoteca)",
    )
    cancel_at_year: int | None = Field(
        default=None,
        description="Año exacto en cuyo inicio conviene cancelar la vinculación con el banco (None si es 0 o toda la hipoteca)",
    )
    total_years: int = Field(..., ge=1, description="Duración total de la hipoteca en años")
    recommendation: str = Field(
        ...,
        description="Recomendación exacta: 'Mantener toda la hipoteca', 'Rechazar desde el día 1' o 'Aceptar años 1 a X y cancelar en el año X+1'",
    )
    crossover_year: int | None = Field(
        default=None,
        description="Primer año en el que el sobrecoste anual del seguro supera al ahorro en intereses de su bonificación",
    )
    cumulative_net_benefit_eur: Decimal = Field(
        default=ZERO,
        description="Beneficio neto acumulado durante los años en que el producto se mantiene activo",
    )
    puf_extra_interest_eur: Decimal = Field(
        default=ZERO,
        description="Si el producto es PUF_FINANCED, intereses extra que generaría financiarlo en la hipoteca",
    )
    yearly_breakdown: list[ProductYearlyBenefitPoint] = Field(
        default_factory=list,
        description="Serie año a año de ahorro en intereses vs sobrecoste del seguro",
    )


class DynamicUnlinkingStrategyResult(BaseModel):
    """Resultado completo del motor de Desvinculación Dinámica por años."""

    model_config = ConfigDict(frozen=True)

    total_years: int
    dynamic_optimal_total_cost_eur: Decimal = Field(
        ...,
        description="Desembolso total real siguiendo la estrategia de cancelación dinámica por años",
    )
    static_optimal_total_cost_eur: Decimal = Field(
        ...,
        description="Desembolso total real del Escenario C estático (sin cancelar a mitad de préstamo)",
    )
    all_bonified_total_cost_eur: Decimal = Field(
        ...,
        description="Desembolso total real del Escenario A (manteniendo todo con el banco toda la hipoteca)",
    )
    extra_savings_vs_static_optimum_eur: Decimal = Field(
        ...,
        description="Ahorro adicional conseguido mediante desvinculación dinámica frente al Escenario C estático",
    )
    total_savings_vs_all_bonified_eur: Decimal = Field(
        ...,
        description="Ahorro total de la estrategia dinámica frente al Escenario A (100% bonificada todo el plazo)",
    )
    dynamic_tae_real_pct: Decimal = Field(
        ...,
        description="TAE Real Oculta resultante de aplicar el plan dinámico por años",
    )
    summary_headline: str = Field(..., description="Titular ejecutivo del plan dinámico por años")
    product_strategies: list[ProductDynamicStrategy] = Field(
        default_factory=list,
        description="Hoja de ruta temporal año a año para cada producto vinculado",
    )
