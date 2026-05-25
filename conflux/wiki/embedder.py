from __future__ import annotations

import logging
import uuid
from uuid import UUID

from qdrant_client.models import FieldCondition, Filter, MatchValue, PointStruct
from sqlalchemy.ext.asyncio import AsyncSession

from conflux.core.config import get_settings
from conflux.core.vector import get_qdrant
from conflux.models.wiki import WikiPage
from conflux.providers.embeddings import EmbeddingProvider
from conflux.wiki.chunker import chunk_text

logger = logging.getLogger(__name__)


async def embed_page(db: AsyncSession, page_id: UUID) -> None:
    """Chunk a wiki page, embed it, and upsert it into the wiki collection."""
    page = await db.get(WikiPage, page_id)
    if page is None:
        return
    if not page.content_text:
        await delete_page_embeddings(page_id)
        return

    chunks = chunk_text(page.content_text, str(page_id), page.title)
    if not chunks:
        return

    try:
        provider = EmbeddingProvider()
        vectors = await provider.embed_texts([chunk.text for chunk in chunks])
    except Exception:
        logger.exception('Failed to embed wiki page %s', page_id)
        return

    if not vectors:
        return
    if len(vectors) != len(chunks):
        logger.warning(
            'Embedding count mismatch for wiki page %s: %d chunks, %d vectors',
            page_id,
            len(chunks),
            len(vectors),
        )

    settings = get_settings()
    points = [
        PointStruct(
            id=str(uuid.uuid5(uuid.NAMESPACE_URL, f'{page_id}:{chunk.chunk_index}')),
            vector=vector,
            payload={
                'page_id': str(page.id),
                'space_id': str(page.space_id),
                'title': page.title,
                'chunk_index': chunk.chunk_index,
                'text': chunk.text,
            },
        )
        for chunk, vector in zip(chunks, vectors, strict=False)
    ]
    if not points:
        return

    try:
        qdrant = get_qdrant()
        await qdrant.delete(
            collection_name=settings.qdrant_collection_wiki,
            points_selector=Filter(
                must=[FieldCondition(key='page_id', match=MatchValue(value=str(page.id)))]
            ),
        )
        await qdrant.upsert(
            collection_name=settings.qdrant_collection_wiki,
            points=points,
        )
    except Exception:
        logger.exception('Failed to upsert wiki page %s into Qdrant', page_id)
        return

    logger.info('Embedded %d chunks for wiki page %s', len(points), page_id)


async def delete_page_embeddings(page_id: UUID) -> None:
    """Remove all wiki embedding points for a page."""
    settings = get_settings()
    qdrant = get_qdrant()
    await qdrant.delete(
        collection_name=settings.qdrant_collection_wiki,
        points_selector=Filter(
            must=[FieldCondition(key='page_id', match=MatchValue(value=str(page_id)))]
        ),
    )
