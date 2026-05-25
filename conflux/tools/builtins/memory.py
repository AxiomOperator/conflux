"""Memory management tools — agents can read and write their own memory."""
from __future__ import annotations

from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import insert

from conflux.tools.registry import ToolDefinition, ToolRegistry


def _scope_id_for_context(scope: str, context) -> str | None:
    scope_map = {
        "user": context.user_id,
        "project": context.project_id,
        "tenant": context.tenant_id,
        "agent": context.session_id,
        "global": "global",
    }
    scope_id = scope_map.get(scope)
    if scope_id is None:
        return None
    return str(scope_id)


async def _memory_read(args: dict, context) -> dict:
    """Read memory entries relevant to a query."""
    query = str(args.get("query", "")).strip()
    scope = str(args.get("scope", "user"))

    try:
        limit = max(1, min(int(args.get("limit", 10)), 20))
    except (TypeError, ValueError):
        limit = 10

    scope_id = _scope_id_for_context(scope, context)
    if scope_id is None:
        return {"error": f"Unsupported or unavailable scope: {scope}"}

    from conflux.core.database import get_db_session
    from conflux.models.memory import Memory

    async with get_db_session() as db:
        stmt = select(Memory).where(
            Memory.scope == scope,
            Memory.scope_id == scope_id,
        )
        if query:
            like_query = f"%{query}%"
            stmt = stmt.where(
                or_(
                    Memory.key.ilike(like_query),
                    Memory.value.ilike(like_query),
                )
            )
        stmt = stmt.limit(limit)
        result = await db.execute(stmt)
        memories = result.scalars().all()

    return {
        "memories": [
            {"key": memory.key, "value": memory.value, "tags": memory.tags}
            for memory in memories
        ]
    }


async def _memory_write(args: dict, context) -> dict:
    """Write a memory entry."""
    key = str(args.get("key", "")).strip()
    value = str(args.get("value", "")).strip()
    scope = str(args.get("scope", "user"))
    tags = args.get("tags", [])

    if not key or not value:
        return {"error": "Both 'key' and 'value' are required"}

    if not isinstance(tags, list) or not all(isinstance(tag, str) for tag in tags):
        return {"error": "'tags' must be a list of strings"}

    scope_id = _scope_id_for_context(scope, context)
    if scope_id is None:
        return {"error": f"Unsupported or unavailable scope: {scope}"}

    from conflux.core.database import get_db_session
    from conflux.models.memory import Memory

    async with get_db_session() as db:
        stmt = insert(Memory).values(
            scope=scope,
            scope_id=scope_id,
            key=key,
            value=value,
            tags=tags,
            user_id=context.user_id,
        ).on_conflict_do_update(
            index_elements=["scope", "scope_id", "key"],
            set_={"value": value, "tags": tags},
        )
        await db.execute(stmt)

    return {"status": "ok", "key": key}


def register(registry: ToolRegistry) -> None:
    registry.register(
        ToolDefinition(
            name="memory_read",
            description="Read memory entries. Use to recall facts, preferences, or learned information.",
            parameters={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "What to recall"},
                    "scope": {
                        "type": "string",
                        "enum": ["user", "project", "tenant", "agent", "global"],
                        "default": "user",
                    },
                    "limit": {"type": "integer", "default": 10},
                },
                "required": ["query"],
            },
            risk_level="safe",
            fn=_memory_read,
        )
    )

    registry.register(
        ToolDefinition(
            name="memory_write",
            description="Write a fact or lesson to memory for future use.",
            parameters={
                "type": "object",
                "properties": {
                    "key": {"type": "string", "description": "Short identifier for the memory"},
                    "value": {"type": "string", "description": "The memory content"},
                    "scope": {
                        "type": "string",
                        "enum": ["user", "project", "tenant", "agent", "global"],
                        "default": "user",
                    },
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                        "default": [],
                    },
                },
                "required": ["key", "value"],
            },
            risk_level="safe",
            fn=_memory_write,
        )
    )
