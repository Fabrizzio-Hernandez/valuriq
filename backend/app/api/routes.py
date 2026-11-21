"""
Router REST principal v1 de Valuriq (valuriq.com) documentado en OpenAPI.
"""

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import (
    AuditCalculationRequest,
    AuditCalculationResponse,
    BankBattleRequest,
    DynamicStrategyRequest,
    EarlyRepaymentSimulationRequest,
    HealthCheckResponse,
    PresetItemResponse,
    SavedAuditResponse,
    StressTestRequest,
)
from app.db.session import get_db_session
from app.domain.comparison import (
    BankBattleComparisonResult,
    compare_mortgage_offers_battle,
)
from app.domain.day_one_costs import (
    DayOneCostsInput,
    DayOneCostsResult,
    RegionTaxRule,
    calculate_day_one_costs,
    list_spanish_regions_tax_rules,
)
from app.domain.dynamic_unlinking import optimize_dynamic_unlinking_strategy
from app.domain.early_repayment import compare_early_repayment_strategies
from app.domain.models import (
    DynamicUnlinkingStrategyResult,
    EarlyRepaymentComparisonResult,
    MortgageAuditResult,
    MortgageOfferInput,
)
from app.domain.optimizer import optimize_mortgage_offer
from app.domain.presets import get_bank_battle_preset, get_spanish_mortgage_presets
from app.domain.stress_test import StressTestResult, run_euribor_stress_and_effort_test
from app.services.audit_service import create_and_save_audit, get_audit_record_by_slug
from app.services.pdf_service import generate_audit_pdf_bytes

router = APIRouter(tags=["Valuriq Auditoría Hipotecaria"])

_PRESET_UI_METADATA: dict[str, tuple[str, str, str]] = {
    "fija_tipica_trampa": (
        "Oferta típica Fija 2.60% bonificada vs 3.40% base",
        "220.000 € a 30 años · Nómina + Hogar + Vida + Alarma",
        "Fija 30 Años",
    ),
    "fija_trampa_puf": (
        "Hipoteca Fija con Seguro de Vida PUF (12.000 € financiados)",
        "220.000 € a 30 años · Vida PUF 12.000 € sumado al préstamo",
        "Trampa PUF",
    ),
    "mixta_5_anos": (
        "Hipoteca Mixta 5 años Fija (2.10% bonif.) + Euríbor",
        "250.000 € a 30 años · 5 años fijos + 25 variables",
        "Mixta 5 Años",
    ),
    "variable_agresiva": (
        "Hipoteca Variable Euríbor + 0.50% con 5 vinculaciones",
        "180.000 € a 25 años · Nómina + Hogar + Vida + Alarma + Pensiones",
        "Variable 25 Años",
    ),
}


def _slim_audit_ranking_schedules(audit: MortgageAuditResult) -> MortgageAuditResult:
    """
    Mantiene intactos los cuadros mensuales (360 filas) y anuales (30 filas) en los
    Escenarios A, B y C, y aligera las listas `monthly_schedule` / `yearly_summary`
    duplicadas dentro de `ranking` para reducir el payload JSON en >80% sin perder datos en la UI.
    """
    slim_ranking = [
        combo.model_copy(update={"monthly_schedule": [], "yearly_summary": []})
        for combo in audit.ranking
    ]
    return audit.model_copy(update={"ranking": slim_ranking})


@router.get(
    "/health",
    response_model=HealthCheckResponse,
    summary="Comprobar estado de salud de la API",
)
async def health_check() -> HealthCheckResponse:
    """Devuelve el estado operativo del backend de Valuriq."""
    return HealthCheckResponse()


@router.get(
    "/presets",
    response_model=list[PresetItemResponse],
    summary="Obtener presets de ofertas hipotecarias típicas en España",
)
async def list_presets() -> list[PresetItemResponse]:
    """
    Devuelve una colección de ofertas hipotecarias reales del mercado español
    listas para cargar en 1 clic desde el formulario reactivo en Angular.
    """
    raw_presets = get_spanish_mortgage_presets()
    items: list[PresetItemResponse] = []
    for preset_id, offer in raw_presets.items():
        title, subtitle, badge = _PRESET_UI_METADATA.get(
            preset_id,
            (offer.offer_name, f"{offer.principal_eur} € · {offer.term_months // 12} años", offer.mortgage_type.value),
        )
        items.append(
            PresetItemResponse(
                id=preset_id,
                title=title,
                subtitle=subtitle,
                badge=badge,
                offer=offer,
            )
        )
    return items


@router.post(
    "/audits/calculate",
    response_model=AuditCalculationResponse,
    summary="Ejecutar Optimizador Combinatorio 2^N (sin persistencia)",
)
def calculate_audit(payload: AuditCalculationRequest) -> AuditCalculationResponse:
    """
    Evalúa en tiempo real las 2^N combinaciones de vinculaciones de la oferta hipotecaria,
    calcula la TAE Real Oculta (TIR) de cada escenario y devuelve los Escenarios A, B y C,
    el veredicto ejecutivo y el ranking completo.
    """
    audit_result = optimize_mortgage_offer(payload.offer)
    dynamic_strategy = optimize_dynamic_unlinking_strategy(
        offer=payload.offer,
        static_audit=audit_result,
    )

    early_result: EarlyRepaymentComparisonResult | None = None
    if payload.early_repayment_config is not None:
        optimal_accepted = set(audit_result.scenario_c_optimal.accepted_product_ids)
        early_result = compare_early_repayment_strategies(
            offer=payload.offer,
            config=payload.early_repayment_config,
            accepted_product_ids=optimal_accepted,
        )

    return AuditCalculationResponse(
        audit_result=_slim_audit_ranking_schedules(audit_result),
        early_repayment_result=early_result,
        dynamic_strategy=dynamic_strategy,
    )


@router.post(
    "/audits/dynamic-strategy",
    response_model=DynamicUnlinkingStrategyResult,
    summary="Calcular Plan Óptimo de Desvinculación Dinámica por Años",
)
def calculate_dynamic_unlinking_strategy(
    payload: DynamicStrategyRequest,
) -> DynamicUnlinkingStrategyResult:
    """
    Determina en qué año exacto conviene cancelar cada producto vinculado de pago anual
    cuando su prima supera el ahorro en intereses de la bonificación sobre el saldo vivo.
    """
    return optimize_dynamic_unlinking_strategy(offer=payload.offer)


@router.post(
    "/audits",
    response_model=SavedAuditResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Ejecutar y guardar auditoría con enlace compartible único (slug)",
)
async def create_saved_audit(
    payload: AuditCalculationRequest,
    session: AsyncSession = Depends(get_db_session),
) -> SavedAuditResponse:
    """
    Ejecuta la auditoría combinatoria 2^N y guarda un snapshot inmutable en base de datos
    asociado a un `slug` único compartible.
    """
    record, audit_result, early_result = await create_and_save_audit(
        session=session,
        offer=payload.offer,
        early_repayment_config=payload.early_repayment_config,
    )
    dynamic_strategy = optimize_dynamic_unlinking_strategy(
        offer=payload.offer,
        static_audit=audit_result,
    )
    return SavedAuditResponse(
        id=record.id,
        slug=record.slug,
        created_at=record.created_at,
        audit_result=audit_result,
        early_repayment_result=early_result,
        dynamic_strategy=dynamic_strategy,
    )


@router.get(
    "/audits/{slug}",
    response_model=SavedAuditResponse,
    summary="Recuperar una auditoría guardada mediante su slug único",
)
async def get_saved_audit(
    slug: str,
    session: AsyncSession = Depends(get_db_session),
) -> SavedAuditResponse:
    """
    Recupera el snapshot inmutable de una auditoría previamente guardada mediante su `slug`.
    """
    record = await get_audit_record_by_slug(session, slug)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No se encontró ninguna auditoría con el identificador '{slug}'.",
        )

    audit_result = MortgageAuditResult.model_validate(record.result_snapshot)
    early_result = (
        EarlyRepaymentComparisonResult.model_validate(record.early_repayment_snapshot)
        if record.early_repayment_snapshot is not None
        else None
    )
    dynamic_strategy = optimize_dynamic_unlinking_strategy(
        offer=audit_result.offer,
        static_audit=audit_result,
    )

    return SavedAuditResponse(
        id=record.id,
        slug=record.slug,
        created_at=record.created_at,
        audit_result=audit_result,
        early_repayment_result=early_result,
        dynamic_strategy=dynamic_strategy,
    )


@router.post(
    "/audits/early-repayment",
    response_model=EarlyRepaymentComparisonResult,
    summary="Simular amortizaciones anticipadas (Reducir Cuota vs. Reducir Plazo)",
)
def simulate_early_repayment(
    payload: EarlyRepaymentSimulationRequest,
) -> EarlyRepaymentComparisonResult:
    """
    Simula amortizaciones anticipadas puntuales o periódicas contemplando comisiones
    y compara el ahorro neto entre Reducir Cuota y Reducir Plazo.
    """
    accepted_set = (
        set(payload.accepted_product_ids)
        if payload.accepted_product_ids is not None
        else None
    )
    return compare_early_repayment_strategies(
        offer=payload.offer,
        config=payload.config,
        accepted_product_ids=accepted_set,
    )


@router.post(
    "/audits/pdf",
    summary="Generar y descargar informe comparativo en PDF al vuelo",
    response_class=Response,
)
def export_direct_audit_pdf(payload: AuditCalculationRequest) -> Response:
    """
    Calcula la auditoría hipotecaria y genera un informe comparativo en PDF en memoria
    con ReportLab listo para descargar.
    """
    audit_result = optimize_mortgage_offer(payload.offer)
    early_result: EarlyRepaymentComparisonResult | None = None
    if payload.early_repayment_config is not None:
        optimal_accepted = set(audit_result.scenario_c_optimal.accepted_product_ids)
        early_result = compare_early_repayment_strategies(
            offer=payload.offer,
            config=payload.early_repayment_config,
            accepted_product_ids=optimal_accepted,
        )

    pdf_bytes = generate_audit_pdf_bytes(
        audit=audit_result,
        slug=None,
        early_repayment=early_result,
    )
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": 'attachment; filename="valuriq-informe-comparativo.pdf"'
        },
    )


@router.get(
    "/audits/{slug}/pdf",
    summary="Descargar informe comparativo en PDF de una auditoría guardada por slug",
    response_class=Response,
)
async def export_saved_audit_pdf(
    slug: str,
    session: AsyncSession = Depends(get_db_session),
) -> Response:
    """
    Recupera una auditoría persistida por su `slug` y genera el informe comparativo en PDF.
    """
    record = await get_audit_record_by_slug(session, slug)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No se encontró ninguna auditoría con el identificador '{slug}'.",
        )

    audit_result = MortgageAuditResult.model_validate(record.result_snapshot)
    early_result = (
        EarlyRepaymentComparisonResult.model_validate(record.early_repayment_snapshot)
        if record.early_repayment_snapshot is not None
        else None
    )

    pdf_bytes = generate_audit_pdf_bytes(
        audit=audit_result,
        slug=record.slug,
        early_repayment=early_result,
        created_at=record.created_at,
    )
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="valuriq-auditoria-{record.slug}.pdf"'
        },
    )


@router.get(
    "/tools/regions",
    response_model=list[RegionTaxRule],
    summary="Listar las 17 Comunidades Autónomas + Ceuta y Melilla con tipos de ITP y AJD",
)
async def get_spanish_tax_regions() -> list[RegionTaxRule]:
    """
    Devuelve el catálogo parametrizado de las 19 jurisdicciones fiscales españolas
    con sus tipos generales y reducidos para jóvenes en ITP, IVA/IGIC/IPSI y AJD.
    """
    return list_spanish_regions_tax_rules()


@router.post(
    "/tools/day-one-costs",
    response_model=DayOneCostsResult,
    summary="Calcular Dinero Real en Cuenta el Día 1 (Entrada + Impuestos CCAA + Gastos)",
)
async def compute_day_one_purchase_costs(
    payload: DayOneCostsInput,
) -> DayOneCostsResult:
    """
    Calcula la liquidez total exacta que el comprador necesita tener ahorrada el día de la firma
    según precio de vivienda, % financiado, Comunidad Autónoma, Segunda Mano vs. Obra Nueva
    y reducción por comprador joven.
    """
    try:
        return calculate_day_one_costs(payload)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc


@router.post(
    "/audits/stress-test",
    response_model=StressTestResult,
    summary="Ejecutar Test de Estrés de Euríbor y Tasa de Esfuerzo (35% Banco de España)",
)
def execute_stress_and_effort_test(
    payload: StressTestRequest,
) -> StressTestResult:
    """
    Calcula la tasa de esfuerzo hipotecario actual del hogar (con semáforo <=30% / 30-35% / >35%)
    y simula escenarios de Euríbor al 2%, 3%, 4% y 5%, determinando el nivel crítico de Euríbor
    donde se rompe el umbral del 35% recomendado por el Banco de España.
    """
    accepted_set = (
        set(payload.accepted_product_ids)
        if payload.accepted_product_ids is not None
        else None
    )
    return run_euribor_stress_and_effort_test(
        offer=payload.offer,
        monthly_net_household_income_eur=payload.monthly_net_household_income_eur,
        accepted_product_ids=accepted_set,
    )


@router.get(
    "/presets/battle",
    response_model=list[MortgageOfferInput],
    summary="Obtener 3 ofertas bancarias realistas listas para enfrentar en el Modo Batalla",
)
async def get_battle_presets() -> list[MortgageOfferInput]:
    """
    Devuelve 3 ofertas hipotecarias españolas sobre un mismo capital y plazo (Fija con PUF vs.
    Fija Digital sin vinculaciones vs. Mixta 5 años) para comparar en 1 clic.
    """
    return get_bank_battle_preset()


@router.post(
    "/audits/compare",
    response_model=BankBattleComparisonResult,
    summary="Modo Batalla de Bancos: enfrentar de 2 a 3 ofertas hipotecarias reales",
)
def compare_bank_offers(
    payload: BankBattleRequest,
) -> BankBattleComparisonResult:
    """
    Optimiza cada una de las 2 o 3 ofertas bancarias y enfrenta sus Escenarios Óptimos (C)
    determinando el banco ganador por menor Desembolso Total Real y menor TAE Real Oculta.
    """
    result = compare_mortgage_offers_battle(payload.offers)
    slim_entries = [
        entry.model_copy(
            update={
                "optimal_scenario": entry.optimal_scenario.model_copy(
                    update={"monthly_schedule": []}
                ),
                "all_bonified_scenario": entry.all_bonified_scenario.model_copy(
                    update={"monthly_schedule": [], "yearly_summary": []}
                ),
                "unbonified_scenario": entry.unbonified_scenario.model_copy(
                    update={"monthly_schedule": [], "yearly_summary": []}
                ),
            }
        )
        for entry in result.entries
    ]
    return result.model_copy(update={"entries": slim_entries})
