"""Scoped memory CRUD with Qdrant semantic retrieval."""

from __future__ import annotations

import asyncio

import structlog

from conflux.core.config import get_settings
from conflux.core.events import publish_event
from conflux.core.database import get_db_session

logger = structlog.get_logger(__name__)


class MemoryManager:
    """
    Manages scoped memories for agents.

    Scopes: global > tenant > project > agent > user > session
    """

    async def write(
        self,
        scope: str,
        scope_id: str | None,
        key: str,
        value: str,
        tags: list[str] | None = None,
        user_id: str | None = None,
    ) -> str:
        """Write a memory entry. Returns memory ID."""
        from sqlalchemy.dialects.postgresql import insert

        from conflux.models.memory import Memory

        normalized_tags = tags or []

        async with get_db_session() as db:
            stmt = (
                insert(Memory)
                .values(
                    scope=scope,
                    scope_id=scope_id,
                    key=key,
                    value=value,
                    tags=normalized_tags,
                    user_id=user_id,
                )
                .on_conflict_do_update(
                    index_elements=["scope", "scope_id", "key"],
                    set_={"value": value, "tags": normalized_tags},
                )
                .returning(Memory.id)
            )
            result = await db.execute(stmt)
            memory_id = str(result.scalar_one())

        await self._embed_and_store(memory_id, key, value, scope, scope_id, normalized_tags)
        return memory_id

    async def read(self, scope: str, scope_id: str | None, key: str) -> str | None:
        """Read a specific memory by key."""
        from sqlalchemy import select

        from conflux.models.memory import Memory

        async with get_db_session() as db:
            result = await db.execute(
                select(Memory.value).where(
                    Memory.scope == scope,
                    Memory.scope_id == scope_id,
                    Memory.key == key,
                )
            )
            row = result.first()
            return row[0] if row else None

    async def search(
        self,
        query: str,
        scope: str,
        scope_id: str | None,
        limit: int = 10,
        *,
        run_id: str | None = None,
        agent_id: str | None = None,
        agent_name: str | None = None,
        user_id: str | None = None,
        tenant_id: str | None = None,
    ) -> list[dict]:
        """Semantic search over memories using Qdrant."""
        from conflux.providers.embeddings import EmbeddingProvider
        from qdrant_client.models import FieldCondition, Filter, MatchValue

        settings = get_settings()
        embedder = EmbeddingProvider(
            base_url=settings.embedding_base_url,
            model=settings.embedding_model,
            api_key=settings.embedding_api_key,
        )
        query_vector = await embedder.embed_one(query)

        from conflux.core.vector import get_qdrant

        qdrant = get_qdrant()
        results = await qdrant.search(
            collection_name=settings.qdrant_collection_memory,
            query_vector=query_vector,
            query_filter=Filter(
                must=[
                    FieldCondition(key="scope", match=MatchValue(value=scope)),
                    FieldCondition(key="scope_id", match=MatchValue(value=scope_id or "")),
                ]
            ),
            limit=max(1, limit),
        )

        asyncio.create_task(
            publish_event(
                "memory.searched",
                {"query": query[:100], "scope": scope},
                run_id=run_id,
                agent_id=agent_id,
                agent_name=agent_name,
                user_id=user_id,
                tenant_id=tenant_id,
            )
        )

        return [
            {
                "key": result.payload.get("key"),
                "value": result.payload.get("value"),
                "tags": result.payload.get("tags", []),
                "score": result.score,
            }
            for result in results
        ]

    async def _embed_and_store(
        self,
        memory_id: str,
        key: str,
        value: str,
        scope: str,
        scope_id: str | None,
        tags: list[str],
    ) -> None:
        """Embed memory and store in Qdrant."""
        try:
            from conflux.providers.embeddings import EmbeddingProvider
            from qdrant_client.models import PointStruct

            settings = get_settings()
            embedder = EmbeddingProvider(
                base_url=settings.embedding_base_url,
                model=settings.embedding_model,
                api_key=settings.embedding_api_key,
            )

            from conflux.core.vector import get_qdrant

            vector = await embedder.embed_one(f"{key}: {value}")
            qdrant = get_qdrant()
            await qdrant.upsert(
                collection_name=settings.qdrant_collection_memory,
                points=[
                    PointStruct(
                        id=memory_id,
                        vector=vector,
                        payload={
                            "key": key,
                            "value": value,
                            "scope": scope,
                            "scope_id": scope_id or "",
                            "tags": tags,
                        },
                    )
                ],
            )
        except Exception as exc:  # pragma: no cover - best-effort indexing
            logger.warning("Failed to embed memory", memory_id=memory_id, error=str(exc))
