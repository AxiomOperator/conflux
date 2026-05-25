"""Add Knowledge Wiki tables.

Revision ID: 0016_wiki_system
Revises: 0015_user_onboarding
Create Date: 2026-05-24
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = '0016_wiki_system'
down_revision = '0015_user_onboarding'
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=True)
TIMESTAMP_TZ = sa.DateTime(timezone=True)
TSVECTOR = postgresql.TSVECTOR()


def upgrade() -> None:
    op.create_table(
        'wiki_groups',
        sa.Column('id', UUID, primary_key=True, nullable=False, server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', UUID, sa.ForeignKey('tenants.id'), nullable=True),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('created_at', TIMESTAMP_TZ, nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', TIMESTAMP_TZ, nullable=False, server_default=sa.text('now()')),
    )
    op.create_index('ix_wiki_groups_tenant_id', 'wiki_groups', ['tenant_id'], unique=False)

    op.create_table(
        'wiki_spaces',
        sa.Column('id', UUID, primary_key=True, nullable=False, server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', UUID, sa.ForeignKey('tenants.id'), nullable=True),
        sa.Column('slug', sa.String(length=200), nullable=False),
        sa.Column('name', sa.String(length=500), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('icon', sa.String(length=50), nullable=True),
        sa.Column('default_access', sa.String(length=20), nullable=False, server_default=sa.text("'private'")),
        sa.Column('created_by', UUID, sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', TIMESTAMP_TZ, nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', TIMESTAMP_TZ, nullable=False, server_default=sa.text('now()')),
    )
    op.create_index('ix_wiki_spaces_slug', 'wiki_spaces', ['slug'], unique=False)
    op.create_index('ix_wiki_spaces_tenant_id', 'wiki_spaces', ['tenant_id'], unique=False)

    op.create_table(
        'wiki_pages',
        sa.Column('id', UUID, primary_key=True, nullable=False, server_default=sa.text('gen_random_uuid()')),
        sa.Column('space_id', UUID, sa.ForeignKey('wiki_spaces.id', ondelete='CASCADE'), nullable=False),
        sa.Column('parent_page_id', UUID, sa.ForeignKey('wiki_pages.id'), nullable=True),
        sa.Column('slug', sa.String(length=300), nullable=False),
        sa.Column('title', sa.String(length=500), nullable=False),
        sa.Column('content_markdown', sa.Text(), nullable=True),
        sa.Column('content_text', sa.Text(), nullable=True),
        sa.Column('position', sa.Integer(), nullable=False, server_default=sa.text('0')),
        sa.Column('fts_vector', TSVECTOR, nullable=True),
        sa.Column('created_by', UUID, sa.ForeignKey('users.id'), nullable=True),
        sa.Column('updated_by', UUID, sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', TIMESTAMP_TZ, nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', TIMESTAMP_TZ, nullable=False, server_default=sa.text('now()')),
    )
    op.create_index('ix_wiki_pages_parent_page_id', 'wiki_pages', ['parent_page_id'], unique=False)
    op.create_index('ix_wiki_pages_space_id', 'wiki_pages', ['space_id'], unique=False)
    op.create_index('ix_wiki_pages_fts', 'wiki_pages', ['fts_vector'], unique=False, postgresql_using='gin')

    op.create_table(
        'wiki_group_members',
        sa.Column('id', UUID, primary_key=True, nullable=False),
        sa.Column('group_id', UUID, sa.ForeignKey('wiki_groups.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', UUID, sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_at', TIMESTAMP_TZ, nullable=False),
        sa.UniqueConstraint('group_id', 'user_id'),
    )
    op.create_index('ix_wiki_group_members_group_id', 'wiki_group_members', ['group_id'], unique=False)
    op.create_index('ix_wiki_group_members_user_id', 'wiki_group_members', ['user_id'], unique=False)

    op.create_table(
        'wiki_page_versions',
        sa.Column('id', UUID, primary_key=True, nullable=False),
        sa.Column('page_id', UUID, sa.ForeignKey('wiki_pages.id', ondelete='CASCADE'), nullable=False),
        sa.Column('version_number', sa.Integer(), nullable=False),
        sa.Column('content_markdown', sa.Text(), nullable=True),
        sa.Column('created_by', UUID, sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', TIMESTAMP_TZ, nullable=False),
    )
    op.create_index('ix_wiki_page_versions_page_id', 'wiki_page_versions', ['page_id'], unique=False)

    op.create_table(
        'wiki_access_rules',
        sa.Column('id', UUID, primary_key=True, nullable=False),
        sa.Column('space_id', UUID, sa.ForeignKey('wiki_spaces.id', ondelete='CASCADE'), nullable=True),
        sa.Column('page_id', UUID, sa.ForeignKey('wiki_pages.id', ondelete='CASCADE'), nullable=True),
        sa.Column('subject_type', sa.String(length=20), nullable=False),
        sa.Column('subject_id', UUID, nullable=True),
        sa.Column('permission', sa.String(length=20), nullable=False),
        sa.Column('created_at', TIMESTAMP_TZ, nullable=False),
    )
    op.create_index('ix_wiki_access_rules_page_id', 'wiki_access_rules', ['page_id'], unique=False)
    op.create_index('ix_wiki_access_rules_space_id', 'wiki_access_rules', ['space_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_wiki_access_rules_space_id', table_name='wiki_access_rules')
    op.drop_index('ix_wiki_access_rules_page_id', table_name='wiki_access_rules')
    op.drop_table('wiki_access_rules')

    op.drop_index('ix_wiki_page_versions_page_id', table_name='wiki_page_versions')
    op.drop_table('wiki_page_versions')

    op.drop_index('ix_wiki_group_members_user_id', table_name='wiki_group_members')
    op.drop_index('ix_wiki_group_members_group_id', table_name='wiki_group_members')
    op.drop_table('wiki_group_members')

    op.drop_index('ix_wiki_pages_fts', table_name='wiki_pages', postgresql_using='gin')
    op.drop_index('ix_wiki_pages_space_id', table_name='wiki_pages')
    op.drop_index('ix_wiki_pages_parent_page_id', table_name='wiki_pages')
    op.drop_table('wiki_pages')

    op.drop_index('ix_wiki_spaces_tenant_id', table_name='wiki_spaces')
    op.drop_index('ix_wiki_spaces_slug', table_name='wiki_spaces')
    op.drop_table('wiki_spaces')

    op.drop_index('ix_wiki_groups_tenant_id', table_name='wiki_groups')
    op.drop_table('wiki_groups')
