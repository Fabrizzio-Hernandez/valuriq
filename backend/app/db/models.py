"""
Modelo ORM SQLAlchemy 2.0 de la tabla `audits`.

Utiliza `JSON().with_variant(JSONB(), "postgresql")` para almacenar snapshots
inmutables de entrada y resultado con soporte nativo `JSONB` en PostgreSQL y
compatibilidad transparente con `sqlite+aiosqlite` en tests de integración.
"""

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import DateTime, Integer, JSON, Numeric, String, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

JSONBVariant = JSON().with_variant(JSONB(), "postgresql")


class AuditRecord(Base):
    """Registro persistente e inmutable de una auditoría hipotecaria compartible por `slug`."""

    __tablename__ = "audits"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    slug: Mapped[str] = mapped_column(
        String(64),
        unique=True,
        index=True,
        nullable=False,
        doc="Identificador corto único para compartir la auditoría mediante URL",
    )
    offer_name: Mapped[str] = mapped_column(String(140), nullable=False)
    bank_name: Mapped[str] = mapped_column(String(100), nullable=False)
    mortgage_type: Mapped[str] = mapped_column(String(20), nullable=False)
    principal_eur: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    term_months: Mapped[int] = mapped_column(Integer, nullable=False)
    optimal_savings_eur: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    optimal_tae_real_pct: Mapped[Decimal] = mapped_column(Numeric(8, 4), nullable=False)

    offer_snapshot: Mapped[dict[str, Any]] = mapped_column(
        JSONBVariant,
        nullable=False,
        doc="Snapshot JSONB inmutable del MortgageOfferInput original",
    )
    result_snapshot: Mapped[dict[str, Any]] = mapped_column(
        JSONBVariant,
        nullable=False,
        doc="Snapshot JSONB inmutable del MortgageAuditResult calculado",
    )
    early_repayment_snapshot: Mapped[dict[str, Any] | None] = mapped_column(
        JSONBVariant,
        nullable=True,
        doc="Snapshot JSONB opcional de la simulación de amortización anticipada",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
