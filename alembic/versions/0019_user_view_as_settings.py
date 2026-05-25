"""Add user view-as-user settings.

Revision ID: 0019_user_view_as_settings
Revises: 0018_wiki_page_extra_fields
Create Date: 2026-05-25
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = '0019_user_view_as_settings'
down_revision = '0018_wiki_page_extra_fields'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'user_view_as_settings',
        sa.Column('user_id', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('view_as_user', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )


def downgrade() -> None:
    op.drop_table('user_view_as_settings')
