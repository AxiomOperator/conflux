"""Add wiki_rag_enabled to agents.

Revision ID: 0017_agent_wiki_rag
Revises: 0016_wiki_system
Create Date: 2026-05-24
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = '0017_agent_wiki_rag'
down_revision = '0016_wiki_system'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'agents',
        sa.Column(
            'wiki_rag_enabled',
            sa.Boolean(),
            nullable=False,
            server_default=sa.text('true'),
        ),
    )


def downgrade() -> None:
    op.drop_column('agents', 'wiki_rag_enabled')
