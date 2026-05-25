from __future__ import annotations

import redis.asyncio as redis

from conflux.core.config import get_settings

_redis_pool: redis.ConnectionPool | None = None


def get_redis_pool() -> redis.ConnectionPool:
    global _redis_pool
    if _redis_pool is None:
        settings = get_settings()
        kwargs: dict = {"decode_responses": True}
        if settings.dragonfly_password:
            kwargs["password"] = settings.dragonfly_password
        _redis_pool = redis.ConnectionPool.from_url(settings.dragonfly_url, **kwargs)
    return _redis_pool


def get_redis() -> redis.Redis:
    return redis.Redis(connection_pool=get_redis_pool())


async def close_redis() -> None:
    global _redis_pool
    if _redis_pool is not None:
        await _redis_pool.aclose()
        _redis_pool = None
