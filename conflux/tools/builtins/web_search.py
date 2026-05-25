"""Web search tool using SearXNG."""
from __future__ import annotations

import aiohttp
import structlog

from conflux.core.config import get_settings
from conflux.tools.registry import ToolDefinition, ToolRegistry

logger = structlog.get_logger(__name__)


async def _web_search(args: dict, context) -> dict:
    """Search the web using SearXNG."""
    query = str(args.get("query", "")).strip()
    if not query:
        return {"error": "query is required"}

    try:
        num_results = max(1, min(int(args.get("num_results", 5)), 10))
    except (TypeError, ValueError):
        num_results = 5

    settings = get_settings()
    params = {
        "q": query,
        "format": "json",
        "language": "en",
        "safesearch": 1,
    }

    timeout = aiohttp.ClientTimeout(total=settings.searxng_timeout_ms / 1000)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(f"{settings.searxng_url}/search", params=params) as resp:
            resp.raise_for_status()
            data = await resp.json()

    results = data.get("results", [])[:num_results]
    logger.info("Web search completed", query=query, results=len(results), run_id=context.run_id)
    return {
        "query": query,
        "results": [
            {
                "title": result.get("title", ""),
                "url": result.get("url", ""),
                "content": result.get("content", "")[:500],
                "score": result.get("score"),
            }
            for result in results
        ],
    }


def register(registry: ToolRegistry) -> None:
    registry.register(
        ToolDefinition(
            name="web_search",
            description="Search the web for current information using SearXNG. Returns titles, URLs, and snippets.",
            parameters={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query"},
                    "num_results": {
                        "type": "integer",
                        "description": "Number of results (1-10)",
                        "default": 5,
                    },
                },
                "required": ["query"],
            },
            risk_level="safe",
            fn=_web_search,
        )
    )
