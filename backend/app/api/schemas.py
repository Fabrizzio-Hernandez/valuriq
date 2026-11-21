"""
Esquemas Pydantic v2 de entrada y salida para los endpoints REST de Valuriq.
Sincronizados con los contratos TypeScript del frontend Angular.
"""

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.domain.models import (
    DynamicUnlinkingStrategyResult,
    EarlyRepaymentComparisonResult,
    EarlyRepaymentConfig,
    MortgageAuditResult,
    MortgageOfferInput,
    _validate_no_float,
)
from app.domain.money import ZERO, round_currency


class HealthCheckResponse(BaseModel):
    """Respuesta del endpoint de estado del servicio."""

    status: str = "ok"
    service: str = "valuriq-backend"
    version: str = "1.0.0"


class PresetItemResponse(BaseModel):
    """Preset de oferta hipotecaria española enriquecido con metadatos de UI para Angular."""

    model_config = ConfigDict(frozen=True)

    id: str = Field(..., description="Identificador único del preset")
    title: str = Field(..., description="Título corto para botón de preset rápido")
    subtitle: str = Field(..., description="Resumen del TIN bonificado vs base y plazo")
    badge: str = Field(..., description="Etiqueta destacada (ej. 'Fija 30a', 'Mixta 5a', 'Variable')")
    offer: MortgageOfferInput = Field(..., description="Datos completos de la oferta hipotecaria")


class AuditCalculationRequest(BaseModel):
    """Petición para ejecutar una auditoría combinatoria 2^N (con simulación opcional de amortización)."""

    model_config = ConfigDict(extra="forbid")

    offer: MortgageOfferInput = Field(..., description="Oferta hipotecaria y sus productos vinculados (máx. 12)")
    early_repayment_config: EarlyRepaymentConfig | None = Field(
        default=None,
        description="Configuración opcional de amortización anticipada sobre el escenario óptimo",
    )


class AuditCalculationResponse(BaseModel):
    """Respuesta de cálculo directo sin persistencia."""

    audit_result: MortgageAuditResult
    early_repayment_result: EarlyRepaymentComparisonResult | None = None
    dynamic_strategy: DynamicUnlinkingStrategyResult | None = None


class SavedAuditResponse(BaseModel):
    """Respuesta de una auditoría persistida y compartible mediante `slug` único."""

    id: UUID
    slug: str = Field(..., description="Identificador único de enlace compartible")
    created_at: datetime
    audit_result: MortgageAuditResult
    early_repayment_result: EarlyRepaymentComparisonResult | None = None
    dynamic_strategy: DynamicUnlinkingStrategyResult | None = None


class DynamicStrategyRequest(BaseModel):
    """Petición para calcular el plan óptimo de desvinculación dinámica año a año."""

    model_config = ConfigDict(extra="forbid")

    offer: MortgageOfferInput = Field(..., description="Oferta hipotecaria a optimizar dinámicamente por años")


class StressTestRequest(BaseModel):
    """Petición para ejecutar el Test de Estrés de Euríbor y Tasa de Esfuerzo (35% Banco de España)."""

    model_config = ConfigDict(extra="forbid")

    offer: MortgageOfferInput = Field(..., description="Oferta hipotecaria a someter al test de estrés")
    monthly_net_household_income_eur: Decimal = Field(
        ...,
        gt=ZERO,
        le=Decimal("1000000.00"),
        description="Ingresos netos mensuales conjuntos del hogar en euros",
    )
    accepted_product_ids: list[str] | None = Field(
        default=None,
        description="Subconjunto opcional de vinculaciones aceptadas (None = usa el Escenario Óptimo C)",
    )

    @field_validator("monthly_net_household_income_eur", mode="before")
    @classmethod
    def _parse_income_decimal(cls, v: object) -> Decimal:
        return _validate_no_float(v)

    @field_validator("monthly_net_household_income_eur", mode="after")
    @classmethod
    def _quantize_income(cls, v: Decimal) -> Decimal:
        return round_currency(v)


class BankBattleRequest(BaseModel):
    """Petición para enfrentar entre 2 y 3 ofertas bancarias en el Modo Batalla."""

    model_config = ConfigDict(extra="forbid")

    offers: list[MortgageOfferInput] = Field(
        ...,
        min_length=2,
        max_length=3,
        description="Lista de 2 a 3 ofertas hipotecarias de distintas entidades a comparar",
    )


class EarlyRepaymentSimulationRequest(BaseModel):
    """Petición para simular amortizaciones anticipadas comparando Reducir Cuota vs Reducir Plazo."""

    model_config = ConfigDict(extra="forbid")

    offer: MortgageOfferInput = Field(..., description="Oferta hipotecaria base")
    config: EarlyRepaymentConfig = Field(..., description="Parámetros de la amortización anticipada")
    accepted_product_ids: list[str] | None = Field(
        default=None,
        description="IDs de vinculaciones aceptadas (None = usa las vinculaciones de la oferta)",
    )
