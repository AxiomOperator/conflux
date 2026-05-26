"""Fix discord_links and discord_guild_configs id column server defaults

Revision ID: 0025
Revises: 0024
Create Date: 2026-05-25
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = '0025'
down_revision = '0024'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE discord_links ALTER COLUMN id SET DEFAULT gen_random_uuid()")
    op.execute("ALTER TABLE discord_guild_configs ALTER COLUMN id SET DEFAULT gen_random_uuid()")


def downgrade() -> None:
    op.execute("ALTER TABLE discord_links ALTER COLUMN id DROP DEFAULT")
    op.execute("ALTER TABLE discord_guild_configs ALTER COLUMN id DROP DEFAULT")
