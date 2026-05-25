"""Add request_traces table.

Revision ID: 0021_request_traces
Revises: 0020_system_settings
Create Date: 2026-05-26
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = '0021_request_traces'
down_revision = '0020_system_settings'
branch_labels = None
depends_on = None


_CREATED_AT_DESC = sa.text('created_at DESC')


def upgrade() -> None:
    op.create_table(
        'request_traces',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, nullable=False, server_default=sa.text('gen_random_uuid()')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('method', sa.String(length=10), nullable=False),
        sa.Column('path', sa.Text(), nullable=False),
        sa.Column('query_string', sa.Text(), nullable=True),
        sa.Column('status_code', sa.Integer(), nullable=False),
        sa.Column('duration_ms', sa.Float(), nullable=False),
        sa.Column('user_email', sa.Text(), nullable=True),
        sa.Column('remote_ip', sa.Text(), nullable=True),
        sa.Column('user_agent', sa.Text(), nullable=True),
        sa.Column('request_body', sa.Text(), nullable=True),
        sa.Column('response_body', sa.Text(), nullable=True),
    )
    op.create_index('ix_request_traces_created_at_desc', 'request_traces', [_CREATED_AT_DESC], unique=False)
    op.create_index(
        'ix_request_traces_user_created_desc',
        'request_traces',
        ['user_email', _CREATED_AT_DESC],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index('ix_request_traces_user_created_desc', table_name='request_traces')
    op.drop_index('ix_request_traces_created_at_desc', table_name='request_traces')
    op.drop_table('request_traces')
