"""Create audits table with JSONB snapshots and unique slug

Revision ID: 0001_create_audits_table
Revises: None
Create Date: 2026-11-20 16:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0001_create_audits_table"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

JSONBVariant = sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql")


def upgrade() -> None:
    op.create_table(
        "audits",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("slug", sa.String(length=64), nullable=False),
        sa.Column("offer_name", sa.String(length=140), nullable=False),
        sa.Column("bank_name", sa.String(length=100), nullable=False),
        sa.Column("mortgage_type", sa.String(length=20), nullable=False),
        sa.Column("principal_eur", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("term_months", sa.Integer(), nullable=False),
        sa.Column("optimal_savings_eur", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("optimal_tae_real_pct", sa.Numeric(precision=8, scale=4), nullable=False),
        sa.Column("offer_snapshot", JSONBVariant, nullable=False),
        sa.Column("result_snapshot", JSONBVariant, nullable=False),
        sa.Column("early_repayment_snapshot", JSONBVariant, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_audits_slug"), "audits", ["slug"], unique=True)


def downgrade() -> None:
    op.drop_index(op.f("ix_audits_slug"), table_name="audits")
    op.drop_table("audits")
