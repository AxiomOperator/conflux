"""improvement pipeline tables

Revision ID: 0023
Revises: 0022
Create Date: 2026-05-25
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = '0023'
down_revision = '0022'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'improvement_patterns',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text('gen_random_uuid()')),
        sa.Column('detected_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('pattern_type', sa.String(), nullable=False),
        sa.Column('skill_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('frequency', sa.Integer(), nullable=False, server_default=sa.text('1')),
        sa.Column('severity', sa.Float(), nullable=True),
        sa.Column('is_systemic', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('example_run_ids', postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column('evidence', postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column('status', sa.String(), nullable=False, server_default=sa.text("'new'")),
        sa.ForeignKeyConstraint(['skill_id'], ['skills.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_improvement_patterns_detected_at', 'improvement_patterns', ['detected_at'])
    op.create_index('ix_improvement_patterns_pattern_type', 'improvement_patterns', ['pattern_type'])
    op.create_index('ix_improvement_patterns_status', 'improvement_patterns', ['status'])

    op.create_table(
        'eval_cases',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text('gen_random_uuid()')),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('skill_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('case_type', sa.String(), nullable=False),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('input_context', postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column('expected_behavior', sa.Text(), nullable=False),
        sa.Column('acceptance_criteria', sa.Text(), nullable=True),
        sa.Column('source', sa.String(), nullable=False, server_default=sa.text("'manual'")),
        sa.Column('source_run_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('tags', postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.ForeignKeyConstraint(['skill_id'], ['skills.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['source_run_id'], ['agent_runs.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_eval_cases_skill_id', 'eval_cases', ['skill_id'])
    op.create_index('ix_eval_cases_case_type', 'eval_cases', ['case_type'])

    op.create_table(
        'skill_eval_records',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text('gen_random_uuid()')),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('run_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('skill_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('skill_version', sa.Integer(), nullable=True),
        sa.Column('task_context', sa.Text(), nullable=True),
        sa.Column('selection_reason', sa.Text(), nullable=True),
        sa.Column('expected_benefit', sa.Text(), nullable=True),
        sa.Column('dimensions_improved', postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column('negative_effects', sa.Text(), nullable=True),
        sa.Column('counterfactual_worse', sa.Boolean(), nullable=True),
        sa.Column('evidence_strength', sa.Float(), nullable=True),
        sa.Column('did_improve', sa.Boolean(), nullable=True),
        sa.Column('improvement_detail', sa.Text(), nullable=True),
        sa.Column('recommendation', sa.String(), nullable=False, server_default=sa.text("'keep'")),
        sa.Column('eval_notes', sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(['run_id'], ['agent_runs.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['skill_id'], ['skills.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_skill_eval_records_run_id', 'skill_eval_records', ['run_id'])
    op.create_index('ix_skill_eval_records_skill_id', 'skill_eval_records', ['skill_id'])
    op.create_index('ix_skill_eval_records_created_at', 'skill_eval_records', ['created_at'])

    op.add_column('evolution_candidates', sa.Column('decision', sa.String(), nullable=True))
    op.add_column('evolution_candidates', sa.Column('decision_reason', sa.Text(), nullable=True))
    op.add_column('evolution_candidates', sa.Column('comparison_scores', postgresql.JSONB(), nullable=True))
    op.add_column('evolution_candidates', sa.Column('test_results', postgresql.JSONB(), nullable=True))
    op.add_column('evolution_candidates', sa.Column('detected_pattern', sa.Text(), nullable=True))
    op.add_column('evolution_candidates', sa.Column('pattern_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        'fk_evo_candidate_pattern',
        'evolution_candidates',
        'improvement_patterns',
        ['pattern_id'],
        ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    op.drop_constraint('fk_evo_candidate_pattern', 'evolution_candidates', type_='foreignkey')
    op.drop_column('evolution_candidates', 'pattern_id')
    op.drop_column('evolution_candidates', 'detected_pattern')
    op.drop_column('evolution_candidates', 'test_results')
    op.drop_column('evolution_candidates', 'comparison_scores')
    op.drop_column('evolution_candidates', 'decision_reason')
    op.drop_column('evolution_candidates', 'decision')
    op.drop_table('skill_eval_records')
    op.drop_table('eval_cases')
    op.drop_table('improvement_patterns')
