from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Query
from pydantic import BaseModel

from conflux.api.auth import CurrentUser
from conflux.api.deps import DB
from conflux.wiki.search import hybrid_search

router = APIRouter(prefix='/v1', tags=['wiki'])


class WikiSearchResultOut(BaseModel):
    page_id: str
    space_id: str
    title: str
    snippet: str
    score: float


@router.get('/wiki/search', response_model=list[WikiSearchResultOut])
async def search_wiki(
    db: DB,
    user: CurrentUser,
    q: str = Query(..., min_length=1),
    space_id: UUID | None = Query(None),
    limit: int = Query(10, ge=1, le=50),
) -> list[WikiSearchResultOut]:
    results = await hybrid_search(
        db=db,
        query=q,
        user_id=UUID(user.user_id),
        is_admin=user.is_admin,
        space_id=space_id,
        limit=limit,
        view_as_user=user.view_as_user,
    )
    return [
        WikiSearchResultOut(
            page_id=result.page_id,
            space_id=result.space_id,
            title=result.title,
            snippet=result.snippet,
            score=result.score,
        )
        for result in results
    ]
