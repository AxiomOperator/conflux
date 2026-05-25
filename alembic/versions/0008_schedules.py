"""Add scheduled tasks table.

Revision ID: 0008_schedules
Revises: 0007_mcp_servers
Create Date: 2026-06-07
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0008_schedules"
down_revision = "0007_mcp_servers"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "scheduled_tasks",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("agent_id", UUID(as_uuid=True), sa.ForeignKey("agents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("cron_expr", sa.Text(), nullable=False),
        sa.Column("input_template", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("channel", sa.String(), nullable=True),
        sa.Column("channel_target", sa.Text(), nullable=True),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("next_run", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_run", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_status", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_scheduled_tasks_agent_id", "scheduled_tasks", ["agent_id"])
    op.create_index("ix_scheduled_tasks_created_by", "scheduled_tasks", ["created_by"])
    op.create_index("ix_scheduled_tasks_next_run", "scheduled_tasks", ["next_run"])
    op.create_index("ix_scheduled_tasks_is_enabled", "scheduled_tasks", ["is_enabled"])


def downgrade() -> None:
    op.drop_index("ix_scheduled_tasks_is_enabled", table_name="scheduled_tasks")
    op.drop_index("ix_scheduled_tasks_next_run", table_name="scheduled_tasks")
    op.drop_index("ix_scheduled_tasks_created_by", table_name="scheduled_tasks")
    op.drop_index("ix_scheduled_tasks_agent_id", table_name="scheduled_tasks")
    op.drop_table("scheduled_tasks")
