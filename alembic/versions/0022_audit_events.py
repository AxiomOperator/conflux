"""audit events table

Revision ID: 0022
Revises: 0021_request_traces
Create Date: 2026-05-25
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = '0022'
down_revision = '0021_request_traces'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'audit_events',
        sa.Column(
            'id',
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text('gen_random_uuid()'),
        ),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('event_type', sa.String(), nullable=False),
        sa.Column('agent_run_id', sa.String(), nullable=True),
        sa.Column('user_id', sa.String(), nullable=True),
        sa.Column('session_id', sa.String(), nullable=True),
        sa.Column('tool_name', sa.String(), nullable=True),
        sa.Column('args_preview', sa.Text(), nullable=True),
        sa.Column('result_preview', sa.Text(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('duration_ms', sa.Float(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_audit_events_created_at', 'audit_events', ['created_at'])
    op.create_index('ix_audit_events_agent_run_id', 'audit_events', ['agent_run_id'])
    op.create_index('ix_audit_events_event_type', 'audit_events', ['event_type'])


def downgrade() -> None:
    op.drop_index('ix_audit_events_event_type', table_name='audit_events')
    op.drop_index('ix_audit_events_agent_run_id', table_name='audit_events')
    op.drop_index('ix_audit_events_created_at', table_name='audit_events')
    op.drop_table('audit_events')
