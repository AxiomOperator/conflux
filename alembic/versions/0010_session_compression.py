"""Add session compression fields to agent runs.

Revision ID: 0010_session_compression
Revises: 0009_sso_settings
Create Date: 2026-05-26
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0010_session_compression"
down_revision = "0009_sso_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("agent_runs", sa.Column("compressed_context", sa.Text(), nullable=True))
    op.add_column(
        "agent_runs",
        sa.Column(
            "is_compressed",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("agent_runs", "is_compressed")
    op.drop_column("agent_runs", "compressed_context")
