"""Add onboarding_completed to users.

Revision ID: 0015_user_onboarding
Revises: 0014_personality_preset
Create Date: 2026-05-24
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = '0015_user_onboarding'
down_revision = '0014_personality_preset'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'users',
        sa.Column(
            'onboarding_completed',
            sa.Boolean(),
            nullable=False,
            server_default=sa.text('false'),
        ),
    )


def downgrade() -> None:
    op.drop_column('users', 'onboarding_completed')
