"""SkillsMP marketplace search tool for agents."""
from __future__ import annotations

import structlog

from conflux.tools.registry import ToolDefinition, ToolRegistry

logger = structlog.get_logger(__name__)


async def _search_skills_marketplace(args: dict, context) -> dict:
    """Search the SkillsMP marketplace for relevant skills."""
    from conflux.integrations.skillsmp import search_marketplace

    query = str(args.get("query", "")).strip()
    if not query:
        return {"error": "query is required"}

    limit = max(1, min(int(args.get("limit", 5)), 20))

    try:
        result = await search_marketplace(query, limit=limit)
    except Exception as exc:
        logger.warning("SkillsMP search failed", error=str(exc), run_id=context.run_id)
        return {"error": f"Marketplace search failed: {exc}"}

    skills = result.get("skills", [])
    logger.info("Marketplace search", query=query, results=len(skills), run_id=context.run_id)
    return {
        "query": query,
        "results": [
            {
                "name": s.get("name", ""),
                "author": s.get("author", ""),
                "description": s.get("description", ""),
                "github_url": s.get("githubUrl", ""),
                "stars": s.get("stars", 0),
                "marketplace_url": s.get("skillUrl", ""),
            }
            for s in skills
        ],
    }


def register(registry: ToolRegistry) -> None:
    registry.register(
        ToolDefinition(
            name="search_skills_marketplace",
            description=(
                "Search the SkillsMP marketplace for community-published agent skills. "
                "Use this to discover reusable skills for tasks like web search, data processing, "
                "API integrations, and more."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "What kind of skill to search for (e.g. 'weather lookup', 'data analysis')",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Number of results to return (1-20)",
                        "default": 5,
                    },
                },
                "required": ["query"],
            },
            risk_level="safe",
            fn=_search_skills_marketplace,
        )
    )
