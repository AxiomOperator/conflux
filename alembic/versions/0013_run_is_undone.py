"""Add is_undone flag to agent runs.

Revision ID: 0013_run_is_undone
Revises: 0012_trajectories
Create Date: 2026-05-24
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = '0013_run_is_undone'
down_revision = '0012_trajectories'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'agent_runs',
        sa.Column(
            'is_undone',
            sa.Boolean(),
            nullable=False,
            server_default=sa.text('false'),
        ),
    )


def downgrade() -> None:
    op.drop_column('agent_runs', 'is_undone')
