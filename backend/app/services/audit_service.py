"""
Servicio de aplicación para ejecución, persistencia y recuperación de auditorías hipotecarias.
"""

import re
import secrets
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AuditRecord
from app.domain.early_repayment import compare_early_repayment_strategies
from app.domain.models import (
    EarlyRepaymentComparisonResult,
    EarlyRepaymentConfig,
    MortgageAuditResult,
    MortgageOfferInput,
)
from app.domain.optimizer import optimize_mortgage_offer


def generate_audit_slug(offer_name: str) -> str:
    """
    Genera un `slug` único, legible y seguro para URL a partir del nombre de la oferta
    y un sufijo criptográfico hexadecimal de 8 caracteres.
    """
    normalized = offer_name.lower().strip()
    trans = str.maketrans("áéíóúüñ", "aeiouun")
    normalized = normalized.translate(trans)
    base_slug = re.sub(r"[^a-z0-9]+", "-", normalized).strip("-")
    if not base_slug:
        base_slug = "auditoria-valuriq"
    base_slug = base_slug[:36].rstrip("-")
    random_suffix = secrets.token_hex(4)
    return f"{base_slug}-{random_suffix}"


async def create_and_save_audit(
    session: AsyncSession,
    offer: MortgageOfferInput,
    early_repayment_config: EarlyRepaymentConfig | None = None,
) -> tuple[AuditRecord, MortgageAuditResult, EarlyRepaymentComparisonResult | None]:
    """
    Ejecuta el motor de optimización 2^N (y opcionalmente el simulador de amortización
    anticipada sobre el escenario óptimo) y persiste un snapshot inmutable en la tabla `audits`.
    """
    audit_result = optimize_mortgage_offer(offer)

    early_result: EarlyRepaymentComparisonResult | None = None
    if early_repayment_config is not None:
        optimal_accepted = set(audit_result.scenario_c_optimal.accepted_product_ids)
        early_result = compare_early_repayment_strategies(
            offer=offer,
            config=early_repayment_config,
            accepted_product_ids=optimal_accepted,
        )

    slug = generate_audit_slug(offer.offer_name)

    slim_ranking = [
        combo.model_copy(update={"monthly_schedule": [], "yearly_summary": []})
        for combo in audit_result.ranking
    ]
    slim_audit_for_storage = audit_result.model_copy(update={"ranking": slim_ranking})

    record = AuditRecord(
        slug=slug,
        offer_name=offer.offer_name,
        bank_name=offer.bank_name,
        mortgage_type=offer.mortgage_type.value,
        principal_eur=offer.principal_eur,
        term_months=offer.term_months,
        optimal_savings_eur=audit_result.verdict.net_savings_vs_all_bonified_eur,
        optimal_tae_real_pct=audit_result.scenario_c_optimal.tae_real_pct,
        offer_snapshot=offer.model_dump(mode="json"),
        result_snapshot=slim_audit_for_storage.model_dump(mode="json"),
        early_repayment_snapshot=(
            early_result.model_dump(mode="json") if early_result is not None else None
        ),
        created_at=datetime.now(timezone.utc),
    )

    session.add(record)
    await session.commit()
    await session.refresh(record)

    return record, slim_audit_for_storage, early_result


async def get_audit_record_by_slug(
    session: AsyncSession,
    slug: str,
) -> AuditRecord | None:
    """Recupera un registro de auditoría persistido mediante su `slug` único."""
    stmt = select(AuditRecord).where(AuditRecord.slug == slug)
    result = await session.execute(stmt)
    return result.scalar_one_or_none()
