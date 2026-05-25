from __future__ import annotations

import logging
from dataclasses import dataclass
from uuid import UUID

from qdrant_client.models import FieldCondition, Filter, MatchValue
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from conflux.core.config import get_settings
from conflux.core.vector import get_qdrant
from conflux.models.wiki import WikiPage
from conflux.providers.embeddings import EmbeddingProvider
from conflux.wiki.access import check_page_access

logger = logging.getLogger(__name__)


@dataclass
class WikiSearchResult:
    page_id: str
    space_id: str
    title: str
    snippet: str
    score: float


async def hybrid_search(
    db: AsyncSession,
    query: str,
    user_id: UUID,
    is_admin: bool,
    space_id: UUID | None = None,
    limit: int = 10,
    *,
    view_as_user: bool = False,
) -> list[WikiSearchResult]:
    """Hybrid wiki search using semantic vectors plus PostgreSQL full-text search."""
    query_text = query.strip()
    if not query_text:
        return []

    semantic_scores: dict[str, float] = {}
    semantic_snippets: dict[str, str] = {}
    fts_scores: dict[str, float] = {}
    fts_snippets: dict[str, str] = {}
    settings = get_settings()

    try:
        provider = EmbeddingProvider()
        query_vector = (await provider.embed_texts([query_text]))[0]
        qdrant = get_qdrant()
        search_filter = None
        if space_id is not None:
            search_filter = Filter(
                must=[FieldCondition(key='space_id', match=MatchValue(value=str(space_id)))]
            )

        hits = await qdrant.search(
            collection_name=settings.qdrant_collection_wiki,
            query_vector=query_vector,
            limit=max(limit * 2, limit),
            query_filter=search_filter,
        )
        for hit in hits:
            payload = hit.payload or {}
            page_id_value = str(payload.get('page_id') or '')
            if not page_id_value:
                continue
            score = float(hit.score or 0.0)
            if score > semantic_scores.get(page_id_value, float('-inf')):
                semantic_scores[page_id_value] = score
                semantic_snippets[page_id_value] = _snippet_from_text(str(payload.get('text') or ''))
    except Exception:
        logger.warning('Semantic wiki search failed', exc_info=True)

    try:
        sql = """
            SELECT
                id,
                ts_rank(fts_vector, plainto_tsquery('english', :query)) AS rank,
                ts_headline(
                    'english',
                    COALESCE(content_text, ''),
                    plainto_tsquery('english', :query),
                    'MaxFragments=2,MaxWords=25,MinWords=10'
                ) AS snippet
            FROM wiki_pages
            WHERE fts_vector @@ plainto_tsquery('english', :query)
        """
        params: dict[str, object] = {'query': query_text, 'limit': max(limit * 2, limit)}
        if space_id is not None:
            sql += ' AND space_id = :space_id'
            params['space_id'] = space_id
        sql += ' ORDER BY rank DESC LIMIT :limit'

        rows = (await db.execute(text(sql), params)).mappings().all()
        for row in rows:
            page_id_value = str(row['id'])
            fts_scores[page_id_value] = float(row['rank'] or 0.0)
            fts_snippets[page_id_value] = _snippet_from_text(str(row['snippet'] or ''))
    except Exception:
        logger.warning('Wiki FTS search failed', exc_info=True)

    normalized_semantic = _normalize_scores(semantic_scores)
    normalized_fts = _normalize_scores(fts_scores)

    combined_scores = {
        page_id_value: 0.6 * normalized_semantic.get(page_id_value, 0.0)
        + 0.4 * normalized_fts.get(page_id_value, 0.0)
        for page_id_value in (set(normalized_semantic) | set(normalized_fts))
    }
    ranked_page_ids = [
        page_id_value
        for page_id_value, _score in sorted(
            combined_scores.items(),
            key=lambda item: item[1],
            reverse=True,
        )
    ]
    if not ranked_page_ids:
        return []

    page_uuids: list[UUID] = []
    for page_id_value in ranked_page_ids[: limit * 3]:
        try:
            page_uuids.append(UUID(page_id_value))
        except ValueError:
            continue

    if not page_uuids:
        return []

    page_rows = await db.execute(select(WikiPage).where(WikiPage.id.in_(page_uuids)))
    pages_by_id = {str(page.id): page for page in page_rows.scalars().all()}

    results: list[WikiSearchResult] = []
    for page_id_value in ranked_page_ids:
        page = pages_by_id.get(page_id_value)
        if page is None:
            continue
        try:
            has_access = await check_page_access(
                db,
                page,
                user_id,
                is_admin,
                'view',
                view_as_user=view_as_user,
            )
        except Exception:
            logger.warning('Wiki access check failed for page %s', page_id_value, exc_info=True)
            continue
        if not has_access:
            continue

        snippet = (
            semantic_snippets.get(page_id_value)
            or fts_snippets.get(page_id_value)
            or _snippet_from_text(page.content_text or '')
        )
        results.append(
            WikiSearchResult(
                page_id=page_id_value,
                space_id=str(page.space_id),
                title=page.title,
                snippet=snippet,
                score=combined_scores.get(page_id_value, 0.0),
            )
        )
        if len(results) >= limit:
            break

    return results


async def search_for_agent(
    db: AsyncSession,
    query: str,
    user_id: UUID,
    is_admin: bool,
    top_k: int = 5,
    *,
    view_as_user: bool = False,
) -> list[dict[str, object]]:
    """Return wiki results shaped for agent retrieval augmentation."""
    results = await hybrid_search(
        db=db,
        query=query,
        user_id=user_id,
        is_admin=is_admin,
        limit=top_k,
        view_as_user=view_as_user,
    )
    return [
        {
            'title': result.title,
            'snippet': result.snippet,
            'score': result.score,
            'page_id': result.page_id,
            'space_id': result.space_id,
        }
        for result in results
    ]


def _normalize_scores(scores: dict[str, float]) -> dict[str, float]:
    if not scores:
        return {}

    min_score = min(scores.values())
    max_score = max(scores.values())
    if max_score == min_score:
        normalized_value = 1.0 if max_score > 0 else 0.0
        return {key: normalized_value for key in scores}

    return {
        key: (value - min_score) / (max_score - min_score)
        for key, value in scores.items()
    }


def _snippet_from_text(text_value: str, max_length: int = 300) -> str:
    collapsed = ' '.join(text_value.split())
    return collapsed[:max_length]
