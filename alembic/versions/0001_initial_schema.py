"""initial schema

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-05-22 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


UUID = postgresql.UUID(as_uuid=True)
JSONB = postgresql.JSONB(astext_type=sa.Text())
TIMESTAMP_TZ = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.execute('CREATE EXTENSION IF NOT EXISTS "pgcrypto"')

    op.create_table(
        "users",
        sa.Column("id", UUID, primary_key=True, nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("display_name", sa.String(), nullable=False),
        sa.Column("azure_oid", sa.String(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("is_admin", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", TIMESTAMP_TZ, nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", TIMESTAMP_TZ, nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("email", name="uq_users_email"),
        sa.UniqueConstraint("azure_oid", name="uq_users_azure_oid"),
    )

    op.create_table(
        "tenants",
        sa.Column("id", UUID, primary_key=True, nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("slug", sa.String(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", TIMESTAMP_TZ, nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", TIMESTAMP_TZ, nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("name", name="uq_tenants_name"),
        sa.UniqueConstraint("slug", name="uq_tenants_slug"),
    )

    op.create_table(
        "providers",
        sa.Column("id", UUID, primary_key=True, nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("provider_type", sa.String(), nullable=False),
        sa.Column("base_url", sa.String(), nullable=False),
        sa.Column("api_key", sa.String(), nullable=True),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("health_status", sa.String(), nullable=False, server_default=sa.text("'unknown'")),
        sa.Column("last_health_check_at", TIMESTAMP_TZ, nullable=True),
        sa.Column("created_at", TIMESTAMP_TZ, nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", TIMESTAMP_TZ, nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("name", name="uq_providers_name"),
    )

    op.create_table(
        "projects",
        sa.Column("id", UUID, primary_key=True, nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID, sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("slug", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", TIMESTAMP_TZ, nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", TIMESTAMP_TZ, nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_projects_tenant_id", "projects", ["tenant_id"], unique=False)

    op.create_table(
        "api_keys",
        sa.Column("id", UUID, primary_key=True, nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("key_hash", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("last_used_at", TIMESTAMP_TZ, nullable=True),
        sa.Column("expires_at", TIMESTAMP_TZ, nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", TIMESTAMP_TZ, nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", TIMESTAMP_TZ, nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_api_keys_user_id", "api_keys", ["user_id"], unique=False)

    op.create_table(
        "provider_models",
        sa.Column("id", UUID, primary_key=True, nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("provider_id", UUID, sa.ForeignKey("providers.id"), nullable=False),
        sa.Column("model_name", sa.String(), nullable=False),
        sa.Column("display_name", sa.String(), nullable=True),
        sa.Column("context_length", sa.Integer(), nullable=True),
        sa.Column("input_cost_per_1k", sa.Float(), nullable=False, server_default=sa.text("0.0")),
        sa.Column("output_cost_per_1k", sa.Float(), nullable=False, server_default=sa.text("0.0")),
        sa.Column("supports_streaming", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("supports_tool_calls", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", TIMESTAMP_TZ, nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", TIMESTAMP_TZ, nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("provider_id", "model_name", name="uq_provider_models_provider_id_model_name"),
    )
    op.create_index("ix_provider_models_provider_id", "provider_models", ["provider_id"], unique=False)

    op.create_table(
        "sessions",
        sa.Column("id", UUID, primary_key=True, nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", UUID, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("tenant_id", UUID, sa.ForeignKey("tenants.id"), nullable=True),
        sa.Column("project_id", UUID, sa.ForeignKey("projects.id"), nullable=True),
        sa.Column("channel", sa.String(), nullable=False, server_default=sa.text("'api'")),
        sa.Column("channel_session_id", sa.String(), nullable=True),
        sa.Column("title", sa.String(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", TIMESTAMP_TZ, nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", TIMESTAMP_TZ, nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"], unique=False)
    op.create_index("ix_sessions_tenant_id", "sessions", ["tenant_id"], unique=False)
    op.create_index("ix_sessions_project_id", "sessions", ["project_id"], unique=False)
    op.create_index("ix_sessions_channel_session_id", "sessions", ["channel_session_id"], unique=False)

    op.create_table(
        "agents",
        sa.Column("id", UUID, primary_key=True, nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("slug", sa.String(), nullable=False),
        sa.Column("agent_type", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("system_prompt", sa.Text(), nullable=False),
        sa.Column("model_policy", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("tool_allowlist", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("retrieval_tags", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("output_schema", JSONB, nullable=True),
        sa.Column("max_iterations", sa.Integer(), nullable=False, server_default=sa.text("20")),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("tenant_id", UUID, sa.ForeignKey("tenants.id"), nullable=True),
        sa.Column("project_id", UUID, sa.ForeignKey("projects.id"), nullable=True),
        sa.Column("created_by", UUID, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", TIMESTAMP_TZ, nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", TIMESTAMP_TZ, nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("name", name="uq_agents_name"),
        sa.UniqueConstraint("slug", name="uq_agents_slug"),
    )
    op.create_index("ix_agents_tenant_id", "agents", ["tenant_id"], unique=False)
    op.create_index("ix_agents_project_id", "agents", ["project_id"], unique=False)
    op.create_index("ix_agents_created_by", "agents", ["created_by"], unique=False)

    op.create_table(
        "agent_runs",
        sa.Column("id", UUID, primary_key=True, nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("agent_id", UUID, sa.ForeignKey("agents.id"), nullable=False),
        sa.Column("parent_run_id", UUID, sa.ForeignKey("agent_runs.id"), nullable=True),
        sa.Column("session_id", UUID, sa.ForeignKey("sessions.id"), nullable=True),
        sa.Column("user_id", UUID, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default=sa.text("'queued'")),
        sa.Column("input", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("output", JSONB, nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("model_used", sa.String(), nullable=True),
        sa.Column("provider_used", sa.String(), nullable=True),
        sa.Column("started_at", TIMESTAMP_TZ, nullable=True),
        sa.Column("completed_at", TIMESTAMP_TZ, nullable=True),
        sa.Column("token_usage", JSONB, nullable=True),
        sa.Column("created_at", TIMESTAMP_TZ, nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", TIMESTAMP_TZ, nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_agent_runs_agent_id", "agent_runs", ["agent_id"], unique=False)
    op.create_index("ix_agent_runs_parent_run_id", "agent_runs", ["parent_run_id"], unique=False)
    op.create_index("ix_agent_runs_session_id", "agent_runs", ["session_id"], unique=False)
    op.create_index("ix_agent_runs_user_id", "agent_runs", ["user_id"], unique=False)
    op.create_index("ix_agent_runs_status", "agent_runs", ["status"], unique=False)

    op.create_table(
        "run_events",
        sa.Column("id", UUID, primary_key=True, nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("run_id", UUID, sa.ForeignKey("agent_runs.id"), nullable=False),
        sa.Column("event_type", sa.String(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("payload", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", TIMESTAMP_TZ, nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_run_events_run_id", "run_events", ["run_id"], unique=False)

    op.create_table(
        "subagent_delegations",
        sa.Column("id", UUID, primary_key=True, nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("parent_run_id", UUID, sa.ForeignKey("agent_runs.id"), nullable=False),
        sa.Column("child_run_id", UUID, sa.ForeignKey("agent_runs.id"), nullable=False),
        sa.Column("context", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("constraints", JSONB, nullable=True),
        sa.Column("created_at", TIMESTAMP_TZ, nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_subagent_delegations_parent_run_id", "subagent_delegations", ["parent_run_id"], unique=False)
    op.create_index("ix_subagent_delegations_child_run_id", "subagent_delegations", ["child_run_id"], unique=False)

    op.create_table(
        "messages",
        sa.Column("id", UUID, primary_key=True, nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("session_id", UUID, sa.ForeignKey("sessions.id"), nullable=False),
        sa.Column("run_id", UUID, sa.ForeignKey("agent_runs.id"), nullable=True),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("tool_call_id", sa.String(), nullable=True),
        sa.Column("tool_name", sa.String(), nullable=True),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("created_at", TIMESTAMP_TZ, nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_messages_session_id", "messages", ["session_id"], unique=False)
    op.create_index("ix_messages_run_id", "messages", ["run_id"], unique=False)

    op.create_table(
        "memories",
        sa.Column("id", UUID, primary_key=True, nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("scope", sa.String(), nullable=False),
        sa.Column("scope_id", sa.String(), nullable=True),
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("tags", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("qdrant_id", sa.String(), nullable=True),
        sa.Column("user_id", UUID, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", TIMESTAMP_TZ, nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", TIMESTAMP_TZ, nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("scope", "scope_id", "key", name="uq_memories_scope_scope_id_key"),
    )
    op.create_index("ix_memories_key", "memories", ["key"], unique=False)
    op.create_index("ix_memories_user_id", "memories", ["user_id"], unique=False)

    op.create_table(
        "skills",
        sa.Column("id", UUID, primary_key=True, nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("slug", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("category", sa.String(), nullable=True),
        sa.Column("approval_status", sa.String(), nullable=False, server_default=sa.text("'draft'")),
        sa.Column("owner_user_id", UUID, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("tenant_id", UUID, sa.ForeignKey("tenants.id"), nullable=True),
        sa.Column("project_id", UUID, sa.ForeignKey("projects.id"), nullable=True),
        sa.Column("is_global", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("active_version_id", UUID, nullable=True),
        sa.Column("created_at", TIMESTAMP_TZ, nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", TIMESTAMP_TZ, nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("slug", name="uq_skills_slug"),
    )
    op.create_index("ix_skills_name", "skills", ["name"], unique=False)
    op.create_index("ix_skills_owner_user_id", "skills", ["owner_user_id"], unique=False)
    op.create_index("ix_skills_tenant_id", "skills", ["tenant_id"], unique=False)
    op.create_index("ix_skills_project_id", "skills", ["project_id"], unique=False)
    op.create_index("ix_skills_active_version_id", "skills", ["active_version_id"], unique=False)

    op.create_table(
        "skill_versions",
        sa.Column("id", UUID, primary_key=True, nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("skill_id", UUID, sa.ForeignKey("skills.id"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("change_summary", sa.Text(), nullable=True),
        sa.Column("promoted_by", UUID, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("promoted_at", TIMESTAMP_TZ, nullable=True),
        sa.Column("eval_score", sa.Float(), nullable=True),
        sa.Column("created_at", TIMESTAMP_TZ, nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_skill_versions_skill_id", "skill_versions", ["skill_id"], unique=False)
    op.create_index("ix_skill_versions_promoted_by", "skill_versions", ["promoted_by"], unique=False)
    op.create_foreign_key(
        "fk_skills_active_version_id_skill_versions",
        "skills",
        "skill_versions",
        ["active_version_id"],
        ["id"],
    )

    op.create_table(
        "skill_files",
        sa.Column("id", UUID, primary_key=True, nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("skill_id", UUID, sa.ForeignKey("skills.id"), nullable=False),
        sa.Column("version_id", UUID, sa.ForeignKey("skill_versions.id"), nullable=False),
        sa.Column("file_path", sa.String(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", TIMESTAMP_TZ, nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_skill_files_skill_id", "skill_files", ["skill_id"], unique=False)
    op.create_index("ix_skill_files_version_id", "skill_files", ["version_id"], unique=False)

    op.create_table(
        "skill_usage_events",
        sa.Column("id", UUID, primary_key=True, nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("skill_id", UUID, sa.ForeignKey("skills.id"), nullable=False),
        sa.Column("run_id", UUID, sa.ForeignKey("agent_runs.id"), nullable=False),
        sa.Column("was_helpful", sa.Boolean(), nullable=True),
        sa.Column("created_at", TIMESTAMP_TZ, nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_skill_usage_events_skill_id", "skill_usage_events", ["skill_id"], unique=False)
    op.create_index("ix_skill_usage_events_run_id", "skill_usage_events", ["run_id"], unique=False)

    op.create_table(
        "skill_failure_events",
        sa.Column("id", UUID, primary_key=True, nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("skill_id", UUID, sa.ForeignKey("skills.id"), nullable=False),
        sa.Column("run_id", UUID, sa.ForeignKey("agent_runs.id"), nullable=False),
        sa.Column("failure_reason", sa.Text(), nullable=True),
        sa.Column("created_at", TIMESTAMP_TZ, nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_skill_failure_events_skill_id", "skill_failure_events", ["skill_id"], unique=False)
    op.create_index("ix_skill_failure_events_run_id", "skill_failure_events", ["run_id"], unique=False)

    op.create_table(
        "trace_events",
        sa.Column("id", UUID, primary_key=True, nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("run_id", UUID, sa.ForeignKey("agent_runs.id"), nullable=False),
        sa.Column("event_type", sa.String(), nullable=False),
        sa.Column("payload", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", TIMESTAMP_TZ, nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_trace_events_run_id", "trace_events", ["run_id"], unique=False)

    op.create_table(
        "reflection_jobs",
        sa.Column("id", UUID, primary_key=True, nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("run_id", UUID, sa.ForeignKey("agent_runs.id"), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("was_successful", sa.Boolean(), nullable=True),
        sa.Column("learned_memories", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("drafted_skills", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", TIMESTAMP_TZ, nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", TIMESTAMP_TZ, nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_reflection_jobs_run_id", "reflection_jobs", ["run_id"], unique=False)

    op.create_table(
        "evolution_candidates",
        sa.Column("id", UUID, primary_key=True, nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("skill_id", UUID, sa.ForeignKey("skills.id"), nullable=True),
        sa.Column("candidate_type", sa.String(), nullable=False),
        sa.Column("current_content", sa.Text(), nullable=False),
        sa.Column("proposed_content", sa.Text(), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=True),
        sa.Column("eval_score", sa.Float(), nullable=True),
        sa.Column("eval_dataset", JSONB, nullable=True),
        sa.Column("approval_status", sa.String(), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("approved_by", UUID, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("approved_at", TIMESTAMP_TZ, nullable=True),
        sa.Column("created_at", TIMESTAMP_TZ, nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", TIMESTAMP_TZ, nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_evolution_candidates_skill_id", "evolution_candidates", ["skill_id"], unique=False)
    op.create_index("ix_evolution_candidates_approved_by", "evolution_candidates", ["approved_by"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_evolution_candidates_approved_by", table_name="evolution_candidates")
    op.drop_index("ix_evolution_candidates_skill_id", table_name="evolution_candidates")
    op.drop_table("evolution_candidates")

    op.drop_index("ix_reflection_jobs_run_id", table_name="reflection_jobs")
    op.drop_table("reflection_jobs")

    op.drop_index("ix_trace_events_run_id", table_name="trace_events")
    op.drop_table("trace_events")

    op.drop_index("ix_skill_failure_events_run_id", table_name="skill_failure_events")
    op.drop_index("ix_skill_failure_events_skill_id", table_name="skill_failure_events")
    op.drop_table("skill_failure_events")

    op.drop_index("ix_skill_usage_events_run_id", table_name="skill_usage_events")
    op.drop_index("ix_skill_usage_events_skill_id", table_name="skill_usage_events")
    op.drop_table("skill_usage_events")

    op.drop_index("ix_skill_files_version_id", table_name="skill_files")
    op.drop_index("ix_skill_files_skill_id", table_name="skill_files")
    op.drop_table("skill_files")

    op.drop_constraint("fk_skills_active_version_id_skill_versions", "skills", type_="foreignkey")
    op.drop_index("ix_skill_versions_promoted_by", table_name="skill_versions")
    op.drop_index("ix_skill_versions_skill_id", table_name="skill_versions")
    op.drop_table("skill_versions")

    op.drop_index("ix_skills_active_version_id", table_name="skills")
    op.drop_index("ix_skills_project_id", table_name="skills")
    op.drop_index("ix_skills_tenant_id", table_name="skills")
    op.drop_index("ix_skills_owner_user_id", table_name="skills")
    op.drop_index("ix_skills_name", table_name="skills")
    op.drop_table("skills")

    op.drop_index("ix_memories_user_id", table_name="memories")
    op.drop_index("ix_memories_key", table_name="memories")
    op.drop_table("memories")

    op.drop_index("ix_messages_run_id", table_name="messages")
    op.drop_index("ix_messages_session_id", table_name="messages")
    op.drop_table("messages")

    op.drop_index("ix_subagent_delegations_child_run_id", table_name="subagent_delegations")
    op.drop_index("ix_subagent_delegations_parent_run_id", table_name="subagent_delegations")
    op.drop_table("subagent_delegations")

    op.drop_index("ix_run_events_run_id", table_name="run_events")
    op.drop_table("run_events")

    op.drop_index("ix_agent_runs_status", table_name="agent_runs")
    op.drop_index("ix_agent_runs_user_id", table_name="agent_runs")
    op.drop_index("ix_agent_runs_session_id", table_name="agent_runs")
    op.drop_index("ix_agent_runs_parent_run_id", table_name="agent_runs")
    op.drop_index("ix_agent_runs_agent_id", table_name="agent_runs")
    op.drop_table("agent_runs")

    op.drop_index("ix_agents_created_by", table_name="agents")
    op.drop_index("ix_agents_project_id", table_name="agents")
    op.drop_index("ix_agents_tenant_id", table_name="agents")
    op.drop_table("agents")

    op.drop_index("ix_sessions_channel_session_id", table_name="sessions")
    op.drop_index("ix_sessions_project_id", table_name="sessions")
    op.drop_index("ix_sessions_tenant_id", table_name="sessions")
    op.drop_index("ix_sessions_user_id", table_name="sessions")
    op.drop_table("sessions")

    op.drop_index("ix_provider_models_provider_id", table_name="provider_models")
    op.drop_table("provider_models")

    op.drop_index("ix_api_keys_user_id", table_name="api_keys")
    op.drop_table("api_keys")

    op.drop_index("ix_projects_tenant_id", table_name="projects")
    op.drop_table("projects")

    op.drop_table("providers")

    op.drop_table("tenants")

    op.drop_table("users")
