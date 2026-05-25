"""Add MCP server tables.

Revision ID: 0007_mcp_servers
Revises: 0006_telegram_links
Create Date: 2026-06-07
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0007_mcp_servers"
down_revision = "0006_telegram_links"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mcp_servers",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("transport", sa.String(), nullable=False, server_default=sa.text("'stdio'")),
        sa.Column("command", sa.Text(), nullable=True),
        sa.Column("args", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("env", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("url", sa.Text(), nullable=True),
        sa.Column("headers", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("risk_level", sa.String(), nullable=False, server_default=sa.text("'moderate'")),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("name", name="uq_mcp_servers_name"),
    )
    op.create_index("ix_mcp_servers_name", "mcp_servers", ["name"])
    op.create_index("ix_mcp_servers_created_by", "mcp_servers", ["created_by"])

    op.create_table(
        "agent_mcp_servers",
        sa.Column("agent_id", UUID(as_uuid=True), sa.ForeignKey("agents.id", ondelete="CASCADE"), nullable=False, primary_key=True),
        sa.Column("mcp_server_id", UUID(as_uuid=True), sa.ForeignKey("mcp_servers.id", ondelete="CASCADE"), nullable=False, primary_key=True),
    )
    op.create_index("ix_agent_mcp_servers_agent_id", "agent_mcp_servers", ["agent_id"])
    op.create_index("ix_agent_mcp_servers_mcp_server_id", "agent_mcp_servers", ["mcp_server_id"])


def downgrade() -> None:
    op.drop_index("ix_agent_mcp_servers_mcp_server_id", table_name="agent_mcp_servers")
    op.drop_index("ix_agent_mcp_servers_agent_id", table_name="agent_mcp_servers")
    op.drop_table("agent_mcp_servers")

    op.drop_index("ix_mcp_servers_created_by", table_name="mcp_servers")
    op.drop_index("ix_mcp_servers_name", table_name="mcp_servers")
    op.drop_table("mcp_servers")
