"""Seed default Orchestrator agent.

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-22
"""

from __future__ import annotations

import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

# revision identifiers
revision = "0002"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None

ORCHESTRATOR_SYSTEM_PROMPT = """You are Conflux Orchestrator, the central intelligence of the Conflux AI Agent Harness.

Your responsibilities:
1. ANALYZE incoming tasks and determine the best approach
2. DECIDE whether to handle directly, delegate to a specialist agent, or spawn a swarm
3. SPAWN worker agents when tasks benefit from parallelism or specialization
4. MONITOR and SYNTHESIZE results from worker agents
5. LEARN from outcomes to improve future routing

## Agent Management Tools
- `spawn_agent`: Create and run a specialized worker agent for a subtask
- `list_agents`: See available specialist agents
- `skill_list`: Browse available skills
- `skill_read`: Load full skill instructions
- `write_memory`: Persist facts for future use
- `web_search`: Search the web for current information

## Guidelines
- Be autonomous. Don't ask for permission for routine tasks.
- Delegate parallelizable subtasks to worker agents.
- Record important discoveries as memories using write_memory.
- Draft skills when you discover a repeatable, reusable workflow.
- Always verify your work before reporting completion.
""".strip()


def upgrade() -> None:
    conn = op.get_bind()

    # Check if orchestrator agent already exists
    existing = conn.execute(
        sa.text("SELECT id FROM agents WHERE name = 'Orchestrator' LIMIT 1")
    ).first()

    if existing is not None:
        return  # Already seeded

    agent_id = str(uuid.uuid4())
    conn.execute(
        sa.text("""
            INSERT INTO agents (
                id, name, slug, description, agent_type, system_prompt,
                model_policy, tool_allowlist, retrieval_tags,
                max_iterations, is_enabled, created_at, updated_at
            ) VALUES (
                :id, :name, :slug, :description, :agent_type, :system_prompt,
                :model_policy, :tool_allowlist, :retrieval_tags,
                :max_iterations, :is_enabled, NOW(), NOW()
            )
        """),
        {
            "id": agent_id,
            "name": "Orchestrator",
            "slug": "orchestrator",
            "description": "Default orchestrator agent — routes tasks, spawns workers, and manages the agent colony.",
            "agent_type": "orchestrator",
            "system_prompt": ORCHESTRATOR_SYSTEM_PROMPT,
            "model_policy": "{}",
            "tool_allowlist": '["web_search", "skill_list", "skill_read", "skill_draft", "memory_write", "memory_read", "fetch"]',
            "retrieval_tags": "[]",
            "max_iterations": 20,
            "is_enabled": True,
        },
    )


def downgrade() -> None:
    op.get_bind().execute(sa.text("DELETE FROM agents WHERE name = 'Orchestrator'"))
