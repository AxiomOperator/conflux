from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from conflux.api.auth import AuthenticatedUser, require_admin
from conflux.wiki.access import check_page_access


class _ScalarResult:
    def __init__(self, values):
        self._values = values

    def all(self):
        return list(self._values)


class _ExecuteResult:
    def __init__(self, values):
        self._values = values

    def fetchall(self):
        return list(self._values)

    def scalars(self):
        return _ScalarResult(self._values)


class _FakeDB:
    async def execute(self, _query):
        return _ExecuteResult([])

    async def get(self, _model, _value):
        return SimpleNamespace(default_access='private')


def test_authenticated_user_masks_effective_admin_in_preview_mode() -> None:
    user = AuthenticatedUser(
        user_id='user-id',
        email='admin@example.com',
        is_admin=True,
        view_as_user=True,
    )

    assert user.actual_is_admin is True
    assert user.is_admin is False
    assert user.view_as_user is True


@pytest.mark.asyncio
async def test_require_admin_uses_actual_admin_flag() -> None:
    user = AuthenticatedUser(
        user_id='user-id',
        email='admin@example.com',
        is_admin=True,
        view_as_user=True,
    )

    assert await require_admin(user) is user


@pytest.mark.asyncio
async def test_require_admin_rejects_non_admin_user() -> None:
    user = AuthenticatedUser(user_id='user-id', email='user@example.com', is_admin=False)

    with pytest.raises(HTTPException) as exc_info:
        await require_admin(user)

    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_check_page_access_skips_admin_bypass_in_preview_mode() -> None:
    db = _FakeDB()
    page = SimpleNamespace(id=uuid4(), space_id=uuid4())
    user_id = uuid4()

    assert await check_page_access(db, page, user_id, True, 'view') is True
    assert await check_page_access(db, page, user_id, True, 'view', view_as_user=True) is False
