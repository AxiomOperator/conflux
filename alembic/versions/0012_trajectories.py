"""Add trajectories table.

Revision ID: 0012_trajectories
Revises: 0011_fts_search
Create Date: 2026-05-26
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID

revision = '0012_trajectories'
down_revision = '0011_fts_search'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'trajectories',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('run_id', UUID(as_uuid=True), sa.ForeignKey('agent_runs.id', ondelete='SET NULL'), nullable=True),
        sa.Column('user_id', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('agent_id', UUID(as_uuid=True), sa.ForeignKey('agents.id', ondelete='SET NULL'), nullable=True),
        sa.Column('agent_name', sa.Text(), nullable=True),
        sa.Column('system_prompt', sa.Text(), nullable=True),
        sa.Column('messages', JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column('quality_score', sa.Float(), nullable=True),
        sa.Column('status', sa.String(length=32), nullable=False, server_default=sa.text("'pending_review'")),
        sa.Column('tags', ARRAY(sa.Text()), nullable=False, server_default=sa.text("'{}'")),
        sa.Column('message_count', sa.Integer(), nullable=False, server_default=sa.text('0')),
        sa.Column('input_tokens', sa.Integer(), nullable=False, server_default=sa.text('0')),
        sa.Column('output_tokens', sa.Integer(), nullable=False, server_default=sa.text('0')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_trajectories_run_id', 'trajectories', ['run_id'])
    op.create_index('ix_trajectories_user_id', 'trajectories', ['user_id'])
    op.create_index('ix_trajectories_agent_id', 'trajectories', ['agent_id'])
    op.create_index('ix_trajectories_status', 'trajectories', ['status'])


def downgrade() -> None:
    op.drop_index('ix_trajectories_status', table_name='trajectories')
    op.drop_index('ix_trajectories_agent_id', table_name='trajectories')
    op.drop_index('ix_trajectories_user_id', table_name='trajectories')
    op.drop_index('ix_trajectories_run_id', table_name='trajectories')
    op.drop_table('trajectories')
