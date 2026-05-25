"""Add personality preset to user persona files.

Revision ID: 0014_personality_preset
Revises: 0013_run_is_undone
Create Date: 2026-05-29
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = '0014_personality_preset'
down_revision = '0013_run_is_undone'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'user_persona_files',
        sa.Column('personality_preset', sa.String(length=50), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('user_persona_files', 'personality_preset')
