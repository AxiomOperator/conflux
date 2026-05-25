"""Add wiki page extra fields.

Revision ID: 0018_wiki_page_extra_fields
Revises: 0017_agent_wiki_rag
Create Date: 2026-05-25
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = '0018_wiki_page_extra_fields'
down_revision = '0017_agent_wiki_rag'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'wiki_pages',
        sa.Column('sources', JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
    )
    op.add_column(
        'wiki_pages',
        sa.Column('external_links', JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
    )
    op.add_column(
        'wiki_pages',
        sa.Column('internal_links', JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
    )
    op.add_column(
        'wiki_pages',
        sa.Column('tags', JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
    )


def downgrade() -> None:
    op.drop_column('wiki_pages', 'tags')
    op.drop_column('wiki_pages', 'internal_links')
    op.drop_column('wiki_pages', 'external_links')
    op.drop_column('wiki_pages', 'sources')
