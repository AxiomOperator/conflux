"""Add telegram_links table.

Revision ID: 0006_telegram_links
Revises: 0005_user_persona_files
Create Date: 2026-06-07
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0006_telegram_links"
down_revision = "0005_user_persona_files"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "telegram_links",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("telegram_user_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("linked_via_key_id", UUID(as_uuid=True), sa.ForeignKey("api_keys.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    op.create_index("ix_telegram_links_telegram_user_id", "telegram_links", ["telegram_user_id"], unique=True)
    op.create_index("ix_telegram_links_user_id", "telegram_links", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_telegram_links_user_id", table_name="telegram_links")
    op.drop_index("ix_telegram_links_telegram_user_id", table_name="telegram_links")
    op.drop_table("telegram_links")
