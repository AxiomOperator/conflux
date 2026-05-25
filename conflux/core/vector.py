from __future__ import annotations

from qdrant_client import AsyncQdrantClient
from qdrant_client.models import Distance, VectorParams

from conflux.core.config import get_settings

_client: AsyncQdrantClient | None = None

VECTOR_SIZE_DEFAULT = 4096


def get_qdrant() -> AsyncQdrantClient:
    global _client
    if _client is None:
        settings = get_settings()
        _client = AsyncQdrantClient(
            url=settings.qdrant_url,
            api_key=settings.qdrant_api_key or None,
            timeout=30,
        )
    return _client


async def ensure_collections() -> None:
    """Create Qdrant collections if they don't exist."""
    settings = get_settings()
    client = get_qdrant()

    collections = [
        settings.qdrant_collection_documents,
        settings.qdrant_collection_memory,
        settings.qdrant_collection_skills,
        settings.qdrant_collection_wiki,
    ]

    existing = {c.name for c in (await client.get_collections()).collections}

    for name in collections:
        if name not in existing:
            await client.create_collection(
                collection_name=name,
                vectors_config=VectorParams(
                    size=settings.embedding_dimensions,
                    distance=Distance.COSINE,
                ),
            )


async def close_qdrant() -> None:
    global _client
    if _client is not None:
        await _client.close()
        _client = None
