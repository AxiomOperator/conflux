"""Add PostgreSQL full-text search vectors for memories and runs.

Revision ID: 0011_fts_search
Revises: 0010_session_compression
Create Date: 2026-05-24
"""
from __future__ import annotations

from alembic import op

revision = '0011_fts_search'
down_revision = '0010_session_compression'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE memories
        ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
            to_tsvector('english', coalesce(key, '') || ' ' || coalesce(value, ''))
        ) STORED
        """
    )
    op.execute(
        "CREATE INDEX idx_memories_search_vector ON memories USING gin(search_vector)"
    )

    op.execute(
        """
        ALTER TABLE agent_runs
        ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
            to_tsvector(
                'english',
                coalesce(input::text, '') || ' ' || coalesce(output::text, '')
            )
        ) STORED
        """
    )
    op.execute(
        "CREATE INDEX idx_agent_runs_search_vector ON agent_runs USING gin(search_vector)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_agent_runs_search_vector")
    op.execute("ALTER TABLE agent_runs DROP COLUMN IF EXISTS search_vector")
    op.execute("DROP INDEX IF EXISTS idx_memories_search_vector")
    op.execute("ALTER TABLE memories DROP COLUMN IF EXISTS search_vector")
