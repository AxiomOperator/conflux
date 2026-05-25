"""Add system_settings table.

Revision ID: 0020_system_settings
Revises: 0019_user_view_as_settings
Create Date: 2026-05-25
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = '0020_system_settings'
down_revision = '0019_user_view_as_settings'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'system_settings',
        sa.Column('key', sa.String(128), primary_key=True),
        sa.Column('value', sa.Text(), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.Column('updated_by', sa.String(255), nullable=True),
    )


def downgrade() -> None:
    op.drop_table('system_settings')
