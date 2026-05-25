"""Add SSO provider settings table and password_hash to users.

Revision ID: 0009_sso_settings
Revises: 0008_schedules
Create Date: 2026-05-24
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0009_sso_settings"
down_revision = "0008_schedules"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add password_hash column to users (nullable — SSO users don't have one)
    op.add_column(
        "users",
        sa.Column("password_hash", sa.String, nullable=True),
    )

    # SSO provider settings table — one row per provider
    op.create_table(
        "sso_provider_settings",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column("provider", sa.String(64), nullable=False, unique=True),
        sa.Column(
            "enabled",
            sa.Boolean,
            nullable=False,
            default=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
            onupdate=sa.text("now()"),
        ),
    )

    # Seed the five known providers (all disabled by default)
    op.execute(
        """
        INSERT INTO sso_provider_settings (provider, enabled)
        VALUES
            ('azure-ad',     true),
            ('github',       false),
            ('google',       false),
            ('oidc',         false),
            ('credentials',  false)
        ON CONFLICT (provider) DO NOTHING
        """
    )


def downgrade() -> None:
    op.drop_table("sso_provider_settings")
    op.drop_column("users", "password_hash")
