"""Add user_persona_files table.

Revision ID: 0005_user_persona_files
Revises: 0004_user_workspaces
Create Date: 2026-05-23
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0005_user_persona_files"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_persona_files",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("agents_md", sa.Text(), nullable=True),
        sa.Column("soul_md", sa.Text(), nullable=True),
        sa.Column("user_md", sa.Text(), nullable=True),
        sa.Column("identity_md", sa.Text(), nullable=True),
        sa.Column("tools_md", sa.Text(), nullable=True),
        sa.Column("heartbeat_md", sa.Text(), nullable=True),
        sa.Column("boot_md", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_user_persona_files_user_id",
        "user_persona_files",
        ["user_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_user_persona_files_user_id", table_name="user_persona_files")
    op.drop_table("user_persona_files")
