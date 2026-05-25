from __future__ import annotations

"""
Orchestrator agent — autonomously routes tasks to worker agents
and manages the colony lifecycle.
"""

import structlog

from conflux.agents.base import AgentConfig, RunContext
from conflux.agents.loop import AgentLoop

logger = structlog.get_logger(__name__)

ORCHESTRATOR_SYSTEM_PROMPT = """
You are Conflux Orchestrator, the central intelligence of the Conflux AI Agent Harness.

Your responsibilities:
1. ANALYZE incoming tasks and determine the best approach
2. DECIDE whether to handle directly, delegate to a specialist agent, or spawn a swarm
3. SPAWN worker agents when tasks benefit from parallelism or specialization
4. MONITOR and SYNTHESIZE results from worker agents
5. LEARN from outcomes to improve future routing

## Agent Management Tools
You have access to colony management tools:
- `spawn_agent`: Create and run a specialized worker agent for a subtask
- `list_agents`: See available specialist agents
- `delegate_task`: Hand off to a specific existing agent

## Routing Principles
- Simple tasks: Handle directly with your tools
- Complex multi-step tasks: Break into subtasks and spawn workers
- Domain-specific tasks: Route to specialist agents (if available)
- Parallel-safe subtasks: Spawn multiple workers concurrently

Always explain your routing decision before spawning agents.
""".strip()


class OrchestratorAgent:
    """The top-level autonomous orchestrator."""

    def __init__(self):
        from conflux.core.config import get_settings

        settings = get_settings()
        self.config = AgentConfig(
            agent_id="orchestrator",
            name="Conflux Orchestrator",
            agent_type="orchestrator",
            system_prompt=ORCHESTRATOR_SYSTEM_PROMPT,
            model_policy={
                "provider": "ollama",
                "model": settings.ollama_default_model,
                "temperature": 0.7,
            },
            tool_allowlist=[],
            retrieval_tags=["orchestration", "routing", "general"],
            max_iterations=50,
        )

    def create_loop(self, context: RunContext) -> AgentLoop:
        return AgentLoop(config=self.config, context=context)
