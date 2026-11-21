"""
Calculadora de "Dinero Real en Cuenta el Día 1" (Impuestos ITP / IVA + AJD y Gastos
de Compraventa por Comunidad Autónoma en España) para Valuriq.

Arquitectura Limpia:
- Pertenece a `/backend/app/domain/`.
- 100% aritmética `decimal.Decimal` (`ROUND_HALF_UP`), cero `float`, cero dependencias
  de FastAPI o SQLAlchemy.
"""

from decimal import Decimal
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.domain.models import _validate_no_float
from app.domain.money import HUNDRED, ZERO, round_currency, round_rate, round_rate_2


class PropertyTaxRegime(str, Enum):
    """Régimen fiscal de la compraventa de vivienda en España."""

    SECOND_HAND = "SECOND_HAND"  # Segunda mano -> Tributa por ITP autonómico
    NEW_BUILD = "NEW_BUILD"  # Obra nueva libre -> Tributa por IVA (10% o IGIC 7%) + AJD
    NEW_BUILD_VPO = "NEW_BUILD_VPO"  # Obra nueva protegida VPO -> IVA reducido (4% o IGIC 3%) + AJD reducido


class RegionTaxRule(BaseModel):
    """Tipos impositivos autonómicos vigentes de ITP y AJD para compraventa de vivienda."""

    model_config = ConfigDict(frozen=True)

    code: str = Field(..., description="Código identificador de la Comunidad Autónoma")
    name: str = Field(..., description="Nombre oficial de la Comunidad Autónoma o Ciudad Autónoma")
    itp_general_pct: Decimal = Field(..., description="Tipo general de ITP para vivienda de segunda mano (%)")
    itp_young_pct: Decimal = Field(..., description="Tipo reducido de ITP para jóvenes en vivienda habitual (%)")
    young_max_age: int = Field(default=35, description="Edad máxima orientativa para aplicar el tipo joven")
    ajd_new_build_pct: Decimal = Field(..., description="Tipo general de AJD para obra nueva (%)")
    ajd_young_pct: Decimal = Field(..., description="Tipo reducido de AJD para jóvenes / vivienda protegida (%)")
    new_build_indirect_tax_name: str = Field(
        default="IVA",
        description="Nombre del impuesto indirecto en obra nueva ('IVA' en península/Baleares, 'IGIC' en Canarias, 'IPSI' en Ceuta/Melilla)",
    )
    new_build_general_vat_pct: Decimal = Field(
        default=Decimal("10.00"),
        description="Tipo general de IVA/IGIC/IPSI en obra nueva libre (%)",
    )
    new_build_vpo_vat_pct: Decimal = Field(
        default=Decimal("4.00"),
        description="Tipo reducido de IVA/IGIC/IPSI en obra nueva VPO (%)",
    )
    notes: str = Field(..., description="Nota informativa sobre bonificaciones y límites autonómicos")


SPANISH_REGIONS_TAX_CATALOG: dict[str, RegionTaxRule] = {
    "ANDALUCIA": RegionTaxRule(
        code="ANDALUCIA",
        name="Andalucía",
        itp_general_pct=Decimal("7.00"),
        itp_young_pct=Decimal("3.50"),
        young_max_age=35,
        ajd_new_build_pct=Decimal("1.20"),
        ajd_young_pct=Decimal("0.30"),
        notes="ITP general del 7%; tipo reducido del 3,5% para menores de 35 años en vivienda habitual hasta 150.000 €.",
    ),
    "ARAGON": RegionTaxRule(
        code="ARAGON",
        name="Aragón",
        itp_general_pct=Decimal("8.00"),
        itp_young_pct=Decimal("5.00"),
        young_max_age=35,
        ajd_new_build_pct=Decimal("1.50"),
        ajd_young_pct=Decimal("0.50"),
        notes="ITP desde el 8% (tramo inicial hasta 400.000 €); reducción para menores de 35 años hasta 100.000 €.",
    ),
    "ASTURIAS": RegionTaxRule(
        code="ASTURIAS",
        name="Principado de Asturias",
        itp_general_pct=Decimal("8.00"),
        itp_young_pct=Decimal("4.00"),
        young_max_age=35,
        ajd_new_build_pct=Decimal("1.20"),
        ajd_young_pct=Decimal("0.30"),
        notes="ITP del 8% hasta 300.000 €; tipo reducido del 4% para jóvenes hasta 35 años en vivienda habitual.",
    ),
    "BALEARES": RegionTaxRule(
        code="BALEARES",
        name="Illes Balears",
        itp_general_pct=Decimal("8.00"),
        itp_young_pct=Decimal("4.00"),
        young_max_age=36,
        ajd_new_build_pct=Decimal("1.20"),
        ajd_young_pct=Decimal("0.60"),
        notes="ITP del 8% hasta 400.000 €; tipo reducido del 4% para menores de 36 años en primera vivienda habitual.",
    ),
    "CANARIAS": RegionTaxRule(
        code="CANARIAS",
        name="Canarias",
        itp_general_pct=Decimal("6.50"),
        itp_young_pct=Decimal("4.00"),
        young_max_age=35,
        ajd_new_build_pct=Decimal("0.75"),
        ajd_young_pct=Decimal("0.40"),
        new_build_indirect_tax_name="IGIC",
        new_build_general_vat_pct=Decimal("7.00"),
        new_build_vpo_vat_pct=Decimal("3.00"),
        notes="Tributa por IGIC (7% obra nueva) en lugar de IVA; ITP general del 6,5% y reducido joven del 4%.",
    ),
    "CANTABRIA": RegionTaxRule(
        code="CANTABRIA",
        name="Cantabria",
        itp_general_pct=Decimal("7.00"),
        itp_young_pct=Decimal("4.00"),
        young_max_age=36,
        ajd_new_build_pct=Decimal("1.50"),
        ajd_young_pct=Decimal("0.30"),
        notes="ITP del 7% en vivienda habitual; tipo reducido del 4% para menores de 36 años.",
    ),
    "CASTILLA_LA_MANCHA": RegionTaxRule(
        code="CASTILLA_LA_MANCHA",
        name="Castilla-La Mancha",
        itp_general_pct=Decimal("9.00"),
        itp_young_pct=Decimal("5.00"),
        young_max_age=36,
        ajd_new_build_pct=Decimal("1.50"),
        ajd_young_pct=Decimal("0.50"),
        notes="ITP general del 9% (6% en primera vivienda bajo límites); tipo joven del 5% para menores de 36 años.",
    ),
    "CASTILLA_Y_LEON": RegionTaxRule(
        code="CASTILLA_Y_LEON",
        name="Castilla y León",
        itp_general_pct=Decimal("8.00"),
        itp_young_pct=Decimal("4.00"),
        young_max_age=36,
        ajd_new_build_pct=Decimal("1.50"),
        ajd_young_pct=Decimal("0.50"),
        notes="ITP general del 8%; reducido al 4% para menores de 36 años en primera vivienda habitual.",
    ),
    "CATALUNA": RegionTaxRule(
        code="CATALUNA",
        name="Cataluña",
        itp_general_pct=Decimal("10.00"),
        itp_young_pct=Decimal("5.00"),
        young_max_age=32,
        ajd_new_build_pct=Decimal("1.50"),
        ajd_young_pct=Decimal("0.50"),
        notes="ITP del 10% hasta 1.000.000 €; tipo reducido del 5% para jóvenes hasta 32 años con límite de renta.",
    ),
    "CEUTA": RegionTaxRule(
        code="CEUTA",
        name="Ceuta",
        itp_general_pct=Decimal("6.00"),
        itp_young_pct=Decimal("3.00"),
        young_max_age=35,
        ajd_new_build_pct=Decimal("0.50"),
        ajd_young_pct=Decimal("0.25"),
        new_build_indirect_tax_name="IPSI",
        new_build_general_vat_pct=Decimal("4.00"),
        new_build_vpo_vat_pct=Decimal("1.00"),
        notes="Bonificación del 50% en cuota de ITP/AJD para residentes e inmuebles radicados en Ceuta.",
    ),
    "EXTREMADURA": RegionTaxRule(
        code="EXTREMADURA",
        name="Extremadura",
        itp_general_pct=Decimal("8.00"),
        itp_young_pct=Decimal("4.00"),
        young_max_age=36,
        ajd_new_build_pct=Decimal("1.50"),
        ajd_young_pct=Decimal("0.50"),
        notes="ITP del 8% hasta 360.000 €; tipo reducido del 4% para menores de 36 años en vivienda habitual.",
    ),
    "GALICIA": RegionTaxRule(
        code="GALICIA",
        name="Galicia",
        itp_general_pct=Decimal("8.00"),
        itp_young_pct=Decimal("3.00"),
        young_max_age=36,
        ajd_new_build_pct=Decimal("1.50"),
        ajd_young_pct=Decimal("0.50"),
        notes="ITP general del 8%; reducido al 3% para menores de 36 años con límite de patrimonio.",
    ),
    "LA_RIOJA": RegionTaxRule(
        code="LA_RIOJA",
        name="La Rioja",
        itp_general_pct=Decimal("7.00"),
        itp_young_pct=Decimal("5.00"),
        young_max_age=36,
        ajd_new_build_pct=Decimal("1.00"),
        ajd_young_pct=Decimal("0.50"),
        notes="ITP general del 7%; reducido al 5% (o 3% en municipios pequeños) para menores de 36 años.",
    ),
    "MADRID": RegionTaxRule(
        code="MADRID",
        name="Comunidad de Madrid",
        itp_general_pct=Decimal("6.00"),
        itp_young_pct=Decimal("5.40"),
        young_max_age=35,
        ajd_new_build_pct=Decimal("0.75"),
        ajd_young_pct=Decimal("0.40"),
        notes="ITP general del 6% (uno de los más bajos de España) con bonificación del 10% en vivienda habitual hasta 250.000 €.",
    ),
    "MELILLA": RegionTaxRule(
        code="MELILLA",
        name="Melilla",
        itp_general_pct=Decimal("6.00"),
        itp_young_pct=Decimal("3.00"),
        young_max_age=35,
        ajd_new_build_pct=Decimal("0.50"),
        ajd_young_pct=Decimal("0.25"),
        new_build_indirect_tax_name="IPSI",
        new_build_general_vat_pct=Decimal("4.00"),
        new_build_vpo_vat_pct=Decimal("1.00"),
        notes="Bonificación del 50% en cuota de ITP/AJD en inmuebles situados en Melilla.",
    ),
    "MURCIA": RegionTaxRule(
        code="MURCIA",
        name="Región de Murcia",
        itp_general_pct=Decimal("8.00"),
        itp_young_pct=Decimal("3.00"),
        young_max_age=40,
        ajd_new_build_pct=Decimal("1.50"),
        ajd_young_pct=Decimal("0.10"),
        notes="ITP general del 8%; tipo reducido del 3% ampliado para jóvenes de hasta 40 años en vivienda habitual.",
    ),
    "NAVARRA": RegionTaxRule(
        code="NAVARRA",
        name="Comunidad Foral de Navarra",
        itp_general_pct=Decimal("6.00"),
        itp_young_pct=Decimal("5.00"),
        young_max_age=35,
        ajd_new_build_pct=Decimal("0.50"),
        ajd_young_pct=Decimal("0.50"),
        notes="Régimen foral con ITP general del 6% (5% en los primeros 180.303 € de vivienda habitual) y AJD del 0,5%.",
    ),
    "PAIS_VASCO": RegionTaxRule(
        code="PAIS_VASCO",
        name="País Vasco",
        itp_general_pct=Decimal("4.00"),
        itp_young_pct=Decimal("2.50"),
        young_max_age=36,
        ajd_new_build_pct=Decimal("0.50"),
        ajd_young_pct=Decimal("0.50"),
        notes="ITP en vivienda habitual del 4% y reducido del 2,5% para familias numerosas o jóvenes/viviendas hasta umbral foral.",
    ),
    "VALENCIA": RegionTaxRule(
        code="VALENCIA",
        name="Comunitat Valenciana",
        itp_general_pct=Decimal("10.00"),
        itp_young_pct=Decimal("6.00"),
        young_max_age=35,
        ajd_new_build_pct=Decimal("1.50"),
        ajd_young_pct=Decimal("0.10"),
        notes="ITP general del 10%; tipo reducido del 6% (o 8%) para menores de 35 años en primera vivienda habitual hasta 180.000 €.",
    ),
}


class DayOneCostsInput(BaseModel):
    """Datos de entrada para calcular la liquidez total necesaria el Día 1 de la firma."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    property_price_eur: Decimal = Field(
        ...,
        gt=ZERO,
        le=Decimal("15000000.00"),
        description="Precio de compraventa de la vivienda en euros",
    )
    financing_pct: Decimal = Field(
        default=Decimal("80.00"),
        gt=ZERO,
        le=Decimal("100.00"),
        description="Porcentaje del precio de compra financiado mediante hipoteca (ej. 80%)",
    )
    region_code: str = Field(
        default="MADRID",
        min_length=2,
        max_length=40,
        description="Código de Comunidad Autónoma (ej. 'MADRID', 'CATALUNA', 'ANDALUCIA')",
    )
    property_regime: PropertyTaxRegime = Field(
        default=PropertyTaxRegime.SECOND_HAND,
        description="Régimen fiscal: SECOND_HAND (Segunda Mano), NEW_BUILD (Obra Nueva) o NEW_BUILD_VPO",
    )
    apply_young_buyer_reduction: bool = Field(
        default=False,
        description="Si el comprador cumple requisitos de edad/renta para el tipo reducido joven autonómico",
    )
    notary_cost_eur: Decimal | None = Field(
        default=None,
        ge=ZERO,
        description="Coste de notaría de compraventa en € (None = cálculo automático por arancel)",
    )
    registry_cost_eur: Decimal | None = Field(
        default=None,
        ge=ZERO,
        description="Coste de Registro de la Propiedad en € (None = cálculo automático por arancel)",
    )
    gestoria_cost_eur: Decimal = Field(
        default=Decimal("400.00"),
        ge=ZERO,
        description="Coste de gestoría de compraventa en €",
    )
    appraisal_cost_eur: Decimal = Field(
        default=Decimal("450.00"),
        ge=ZERO,
        description="Coste de tasación oficial homologada por Banco de España en €",
    )
    real_estate_agency_fee_eur: Decimal = Field(
        default=ZERO,
        ge=ZERO,
        description="Honorarios de agencia inmobiliaria o personal shopper a cargo del comprador en €",
    )

    @field_validator(
        "property_price_eur",
        "financing_pct",
        "gestoria_cost_eur",
        "appraisal_cost_eur",
        "real_estate_agency_fee_eur",
        mode="before",
    )
    @classmethod
    def _parse_decimals(cls, v: object) -> Decimal:
        return _validate_no_float(v)

    @field_validator("notary_cost_eur", "registry_cost_eur", mode="before")
    @classmethod
    def _parse_optional_decimals(cls, v: object) -> Decimal | None:
        if v is None:
            return None
        return _validate_no_float(v)

    @field_validator(
        "property_price_eur",
        "gestoria_cost_eur",
        "appraisal_cost_eur",
        "real_estate_agency_fee_eur",
        mode="after",
    )
    @classmethod
    def _quantize_money(cls, v: Decimal) -> Decimal:
        return round_currency(v)

    @field_validator("notary_cost_eur", "registry_cost_eur", mode="after")
    @classmethod
    def _quantize_optional_money(cls, v: Decimal | None) -> Decimal | None:
        return round_currency(v) if v is not None else None

    @field_validator("financing_pct", mode="after")
    @classmethod
    def _quantize_pct(cls, v: Decimal) -> Decimal:
        return round_rate(v)


class DayOneCostsResult(BaseModel):
    """Desglose completo del efectivo necesario en cuenta el día de la firma de compraventa e hipoteca."""

    model_config = ConfigDict(frozen=True)

    property_price_eur: Decimal
    financing_pct: Decimal
    mortgage_principal_eur: Decimal = Field(..., description="Importe de capital de la hipoteca a solicitar al banco")
    down_payment_eur: Decimal = Field(..., description="Entrada no financiada a aportar de ahorros (ej. 20%)")
    region: RegionTaxRule
    property_regime: PropertyTaxRegime
    apply_young_buyer_reduction: bool
    applied_itp_pct: Decimal
    itp_amount_eur: Decimal
    indirect_tax_name: str
    applied_iva_pct: Decimal
    iva_amount_eur: Decimal
    applied_ajd_pct: Decimal
    ajd_amount_eur: Decimal
    total_taxes_eur: Decimal
    notary_cost_eur: Decimal
    registry_cost_eur: Decimal
    gestoria_cost_eur: Decimal
    appraisal_cost_eur: Decimal
    real_estate_agency_fee_eur: Decimal
    total_formalization_expenses_eur: Decimal
    total_taxes_and_expenses_eur: Decimal
    taxes_and_expenses_over_price_pct: Decimal
    total_cash_needed_day_one_eur: Decimal = Field(
        ...,
        description="Efectivo total exacto que el comprador necesita tener ahorrado el Día 1 (Entrada + Impuestos + Gastos)",
    )
    young_buyer_tax_savings_eur: Decimal = Field(
        ...,
        description="Ahorro fiscal obtenido por aplicar el tipo reducido joven frente al tipo general autonómico",
    )
    young_buyer_price_cap_warning: str | None = Field(
        default=None,
        description="Aviso informativo si el precio supera los límites habituales para bonificación joven en la CCAA",
    )


def list_spanish_regions_tax_rules() -> list[RegionTaxRule]:
    """Devuelve la lista ordenada alfabéticamente de las 19 regiones fiscales españolas."""
    return sorted(SPANISH_REGIONS_TAX_CATALOG.values(), key=lambda r: r.name)


def _estimate_notary_and_registry(price_eur: Decimal) -> tuple[Decimal, Decimal]:
    """
    Estima aranceles de Notaría y Registro de la Propiedad de la escritura de compraventa
    según escalas orientativas en España.
    """
    notary = round_currency(min(Decimal("1600.00"), max(Decimal("700.00"), Decimal("550.00") + price_eur * Decimal("0.0018"))))
    registry = round_currency(min(Decimal("1100.00"), max(Decimal("420.00"), Decimal("300.00") + price_eur * Decimal("0.0011"))))
    return notary, registry


def calculate_day_one_costs(payload: DayOneCostsInput) -> DayOneCostsResult:
    """
    Calcula en aritmética `Decimal` el efectivo exacto necesario en cuenta el Día 1
    para comprar una vivienda en cualquier Comunidad Autónoma de España.
    """
    region_key = payload.region_code.strip().upper()
    if region_key not in SPANISH_REGIONS_TAX_CATALOG:
        raise ValueError(f"Comunidad Autónoma no reconocida: '{payload.region_code}'.")

    region = SPANISH_REGIONS_TAX_CATALOG[region_key]
    price = payload.property_price_eur

    # Capital hipotecario y entrada
    financing_ratio = payload.financing_pct / HUNDRED
    mortgage_principal = round_currency(price * financing_ratio)
    down_payment = round_currency(price - mortgage_principal)

    # Cálculo de Impuestos (Segunda Mano vs Obra Nueva / VPO)
    if payload.property_regime == PropertyTaxRegime.SECOND_HAND:
        general_tax_pct = region.itp_general_pct
        applied_itp_pct = region.itp_young_pct if payload.apply_young_buyer_reduction else region.itp_general_pct
        itp_amount = round_currency(price * (applied_itp_pct / HUNDRED))
        general_tax_amount = round_currency(price * (general_tax_pct / HUNDRED))
        young_savings = round_currency(max(ZERO, general_tax_amount - itp_amount))

        applied_iva_pct = ZERO
        iva_amount = ZERO
        applied_ajd_pct = ZERO
        ajd_amount = ZERO
    else:
        applied_itp_pct = ZERO
        itp_amount = ZERO

        if payload.property_regime == PropertyTaxRegime.NEW_BUILD_VPO:
            applied_iva_pct = region.new_build_vpo_vat_pct
            applied_ajd_pct = region.ajd_young_pct
            young_savings = ZERO
        else:
            applied_iva_pct = region.new_build_general_vat_pct
            applied_ajd_pct = (
                region.ajd_young_pct if payload.apply_young_buyer_reduction else region.ajd_new_build_pct
            )

        iva_amount = round_currency(price * (applied_iva_pct / HUNDRED))
        ajd_amount = round_currency(price * (applied_ajd_pct / HUNDRED))
        general_ajd_amount = round_currency(price * (region.ajd_new_build_pct / HUNDRED))
        if payload.property_regime != PropertyTaxRegime.NEW_BUILD_VPO:
            young_savings = (
                round_currency(max(ZERO, general_ajd_amount - ajd_amount))
                if payload.apply_young_buyer_reduction
                else ZERO
            )
        else:
            young_savings = (
                round_currency(max(ZERO, general_ajd_amount - ajd_amount))
                if payload.apply_young_buyer_reduction
                else ZERO
            )

    total_taxes = round_currency(itp_amount + iva_amount + ajd_amount)

    est_notary, est_registry = _estimate_notary_and_registry(price)
    notary_eur = payload.notary_cost_eur if payload.notary_cost_eur is not None else est_notary
    registry_eur = payload.registry_cost_eur if payload.registry_cost_eur is not None else est_registry

    total_formalization = round_currency(
        notary_eur
        + registry_eur
        + payload.gestoria_cost_eur
        + payload.appraisal_cost_eur
        + payload.real_estate_agency_fee_eur
    )
    total_taxes_and_expenses = round_currency(total_taxes + total_formalization)
    over_price_pct = round_rate_2((total_taxes_and_expenses / price) * HUNDRED)
    total_cash_day_one = round_currency(down_payment + total_taxes_and_expenses)

    price_cap_warning: str | None = None
    if payload.apply_young_buyer_reduction and price > Decimal("180000.00"):
        price_cap_warning = (
            f"Atención: Para un precio de {price:,.2f} €, verifica los topes máximos de valor del inmueble "
            f"y de renta aplicables en {region.name} ({region.notes})."
        ).replace(",", "_").replace(".", ",").replace("_", ".")

    return DayOneCostsResult(
        property_price_eur=price,
        financing_pct=payload.financing_pct,
        mortgage_principal_eur=mortgage_principal,
        down_payment_eur=down_payment,
        region=region,
        property_regime=payload.property_regime,
        apply_young_buyer_reduction=payload.apply_young_buyer_reduction,
        applied_itp_pct=applied_itp_pct,
        itp_amount_eur=itp_amount,
        indirect_tax_name=region.new_build_indirect_tax_name,
        applied_iva_pct=applied_iva_pct,
        iva_amount_eur=iva_amount,
        applied_ajd_pct=applied_ajd_pct,
        ajd_amount_eur=ajd_amount,
        total_taxes_eur=total_taxes,
        notary_cost_eur=notary_eur,
        registry_cost_eur=registry_eur,
        gestoria_cost_eur=payload.gestoria_cost_eur,
        appraisal_cost_eur=payload.appraisal_cost_eur,
        real_estate_agency_fee_eur=payload.real_estate_agency_fee_eur,
        total_formalization_expenses_eur=total_formalization,
        total_taxes_and_expenses_eur=total_taxes_and_expenses,
        taxes_and_expenses_over_price_pct=over_price_pct,
        total_cash_needed_day_one_eur=total_cash_day_one,
        young_buyer_tax_savings_eur=young_savings,
        young_buyer_price_cap_warning=price_cap_warning,
    )
