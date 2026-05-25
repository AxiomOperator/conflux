from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import TypeVar

import structlog
from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AsyncOpenAI,
    OpenAIError,
    RateLimitError,
)
from tenacity import AsyncRetrying, retry_if_exception, stop_after_attempt, wait_exponential

from conflux.providers.base import ProviderError

LOGGER = structlog.get_logger(__name__)
T = TypeVar("T")


class EmbeddingProvider:
    def __init__(self, base_url: str | None = None, model: str | None = None, api_key: str = ""):
        settings = None
        if base_url is None or model is None:
            from conflux.core.config import get_settings

            settings = get_settings()

        resolved_base_url = (base_url or settings.embedding_base_url).rstrip("/")
        resolved_model = model or settings.embedding_model
        resolved_api_key = api_key or (settings.embedding_api_key if settings else "") or "none"

        self.base_url = resolved_base_url
        self.model = resolved_model
        self.api_key = resolved_api_key  # OpenAI client requires non-empty key; local servers ignore it
        self.client = AsyncOpenAI(
            base_url=self.base_url,
            api_key=self.api_key,
            max_retries=0,
            timeout=30.0,
        )
        self.logger = LOGGER.bind(base_url=self.base_url, model=self.model)

    async def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []

        try:
            response = await self._with_retry(
                "embedding request",
                lambda: self.client.embeddings.create(model=self.model, input=texts),
            )
        except OpenAIError as exc:
            self.logger.exception("embedding_request_failed", error=str(exc))
            raise ProviderError(f"embedding request failed: {exc}", "embedding") from exc

        return [item.embedding for item in response.data]

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        return await self.embed(texts)

    async def embed_one(self, text: str) -> list[float]:
        embeddings = await self.embed([text])
        return embeddings[0]

    async def _with_retry(self, operation: str, func: Callable[[], Awaitable[T]]) -> T:
        async for attempt in AsyncRetrying(
            stop=stop_after_attempt(3),
            wait=wait_exponential(multiplier=1, min=1, max=8),
            retry=retry_if_exception(self._is_retryable_error),
            reraise=True,
        ):
            with attempt:
                return await func()

        raise ProviderError(f"{operation} failed unexpectedly.", "embedding")

    def _is_retryable_error(self, exc: BaseException) -> bool:
        if isinstance(exc, (APIConnectionError, APITimeoutError, RateLimitError)):
            return True
        return isinstance(exc, APIStatusError) and exc.status_code >= 500
