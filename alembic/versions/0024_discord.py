"""discord_links and discord_guild_configs tables

Revision ID: 0024
Revises: 0023
Create Date: 2026-05-25
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = '0024'
down_revision = '0023'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'discord_links',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('discord_user_id', sa.BigInteger(), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('linked_via_key_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['linked_via_key_id'], ['api_keys.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('discord_user_id'),
    )
    op.create_index('ix_discord_links_discord_user_id', 'discord_links', ['discord_user_id'])
    op.create_index('ix_discord_links_user_id', 'discord_links', ['user_id'])

    op.create_table(
        'discord_guild_configs',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('guild_id', sa.String(32), nullable=False),
        sa.Column('guild_name', sa.String(100), nullable=False, server_default=''),
        sa.Column('allowed_role_ids', postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column('notification_channel_id', sa.String(32), nullable=True),
        sa.Column('thread_mode', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('channel_agent_map', postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column('default_agent_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['default_agent_id'], ['agents.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('guild_id'),
    )
    op.create_index('ix_discord_guild_configs_guild_id', 'discord_guild_configs', ['guild_id'])


def downgrade() -> None:
    op.drop_index('ix_discord_guild_configs_guild_id', table_name='discord_guild_configs')
    op.drop_table('discord_guild_configs')
    op.drop_index('ix_discord_links_user_id', table_name='discord_links')
    op.drop_index('ix_discord_links_discord_user_id', table_name='discord_links')
    op.drop_table('discord_links')
