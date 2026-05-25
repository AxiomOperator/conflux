"""tool_configs table

Revision ID: 0003_tool_configs
Revises: 0002_seed_default_orchestrator_agent
Create Date: 2026-05-22 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0003_tool_configs"
down_revision = "0002"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=True)
JSONB = postgresql.JSONB(astext_type=sa.Text())
TIMESTAMP_TZ = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "tool_configs",
        sa.Column(
            "id", UUID, primary_key=True, nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description_override", sa.Text(), nullable=True),
        sa.Column("risk_level", sa.String(), nullable=False, server_default="safe"),
        sa.Column("requires_approval", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("is_builtin", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        # Custom webhook tool fields
        sa.Column("endpoint_url", sa.Text(), nullable=True),
        sa.Column("http_method", sa.String(), nullable=True, server_default="POST"),
        sa.Column("custom_headers", JSONB, nullable=True),
        sa.Column("custom_parameters", JSONB, nullable=True),
        sa.Column("created_at", TIMESTAMP_TZ, nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", TIMESTAMP_TZ, nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("name", name="uq_tool_configs_name"),
    )


def downgrade() -> None:
    op.drop_table("tool_configs")
