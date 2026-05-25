"""Add personal workspace columns for per-user isolation.

Adds:
  - users.personal_project_id   — FK to projects.id (nullable)
  - users.personal_tenant_id    — FK to tenants.id  (nullable)
  - projects.owner_user_id      — FK to users.id    (nullable) marks personal projects

Revision ID: 0004
Revises: 0003
Create Date: 2026-05-22
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0004"
down_revision = "0003_tool_configs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add workspace columns to users
    op.add_column(
        "users",
        sa.Column(
            "personal_project_id",
            UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "personal_tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    # Mark personal (auto-provisioned) projects
    op.add_column(
        "projects",
        sa.Column(
            "owner_user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
            index=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("projects", "owner_user_id")
    op.drop_column("users", "personal_tenant_id")
    op.drop_column("users", "personal_project_id")
