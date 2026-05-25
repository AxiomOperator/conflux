from __future__ import annotations

import json
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any, TypeVar

import structlog
import tiktoken
from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AsyncOpenAI,
    OpenAIError,
    RateLimitError,
)
from tenacity import AsyncRetrying, retry_if_exception, stop_after_attempt, wait_exponential

from conflux.providers.base import (
    AbstractLLMProvider,
    ChatMessage,
    CompletionChunk,
    CompletionRequest,
    CompletionResponse,
    ProviderError,
    ToolDefinition,
)

LOGGER = structlog.get_logger(__name__)
T = TypeVar("T")


class OpenAICompatProvider(AbstractLLMProvider):
    """Base provider for OpenAI-compatible chat completion APIs."""

    provider_type = "openai-compatible"

    def __init__(self, base_url: str, api_key: str, default_model: str = ""):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key or "none"  # OpenAI client requires non-empty key; local servers ignore it
        self.default_model = default_model
        self.client = AsyncOpenAI(
            base_url=self.base_url,
            api_key=self.api_key,
            max_retries=0,
            timeout=30.0,
        )
        self.logger = LOGGER.bind(provider_type=self.provider_type, base_url=self.base_url)

    async def complete(self, request: CompletionRequest) -> CompletionResponse:
        payload = self._build_payload(request, stream=False)

        try:
            response = await self._with_retry(
                "chat completion",
                lambda: self.client.chat.completions.create(**payload),
            )
        except OpenAIError as exc:
            raise self._raise_provider_error("chat completion", exc) from exc

        if not response.choices:
            raise ProviderError("No completion choices returned.", self.provider_type)

        choice = response.choices[0]
        content = self._coerce_content(choice.message.content)
        tool_calls = self._serialize_tool_calls(choice.message.tool_calls)
        usage = response.usage

        input_tokens = usage.prompt_tokens if usage and usage.prompt_tokens is not None else self._estimate_request_tokens(request)
        output_tokens = (
            usage.completion_tokens
            if usage and usage.completion_tokens is not None
            else self._estimate_response_tokens(request.model or self.default_model, content, tool_calls)
        )
        total_tokens = usage.total_tokens if usage and usage.total_tokens is not None else input_tokens + output_tokens

        return CompletionResponse(
            content=content,
            tool_calls=tool_calls,
            finish_reason=choice.finish_reason or "stop",
            model=response.model or request.model or self.default_model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=total_tokens,
        )

    async def stream(self, request: CompletionRequest) -> AsyncIterator[CompletionChunk]:
        payload = self._build_payload(request, stream=True)
        # Request usage in the final streaming chunk (OpenAI + vllm support this)
        payload["stream_options"] = {"include_usage": True}

        try:
            stream = await self._with_retry(
                "streaming chat completion",
                lambda: self.client.chat.completions.create(**payload),
            )
        except OpenAIError as exc:
            raise self._raise_provider_error("streaming chat completion", exc) from exc

        try:
            async for chunk in stream:
                # Usage-only chunk (no choices) — emitted as the last chunk
                if not chunk.choices:
                    if chunk.usage:
                        yield CompletionChunk(
                            usage={
                                "prompt_tokens": chunk.usage.prompt_tokens or 0,
                                "completion_tokens": chunk.usage.completion_tokens or 0,
                                "total_tokens": chunk.usage.total_tokens or 0,
                            }
                        )
                    continue

                choice = chunk.choices[0]
                delta_content = self._coerce_content(choice.delta.content)
                delta_tool_calls = self._serialize_tool_calls(choice.delta.tool_calls)
                finish_reason = choice.finish_reason

                if delta_content is None and not delta_tool_calls and finish_reason is None:
                    continue

                yield CompletionChunk(
                    delta_content=delta_content,
                    delta_tool_calls=delta_tool_calls,
                    finish_reason=finish_reason,
                )
        except OpenAIError as exc:
            raise self._raise_provider_error("streaming chat completion", exc) from exc

    async def list_models(self) -> list[str]:
        try:
            response = await self._with_retry("model listing", self.client.models.list)
        except OpenAIError as exc:
            raise self._raise_provider_error("model listing", exc) from exc

        return [model.id for model in response.data]

    async def health_check(self) -> bool:
        try:
            await self.list_models()
        except Exception:
            return False
        return True

    def _build_payload(self, request: CompletionRequest, *, stream: bool) -> dict[str, Any]:
        model = request.model or self.default_model
        if not model:
            raise ProviderError("No model specified for completion request.", self.provider_type)

        payload: dict[str, Any] = {
            "model": model,
            "messages": [self._message_to_dict(message) for message in request.messages],
            "temperature": request.temperature,
            "stream": stream,
        }

        if request.max_tokens is not None:
            payload["max_tokens"] = request.max_tokens
        if request.stop:
            payload["stop"] = request.stop
        if request.tools:
            payload["tools"] = request.tools  # already in OpenAI format

        for key, value in request.extra.items():
            if value is not None:
                payload[key] = value

        payload["model"] = model
        payload["messages"] = [self._message_to_dict(message) for message in request.messages]
        payload["stream"] = stream
        return payload

    def _message_to_dict(self, message: ChatMessage) -> dict[str, Any]:
        payload: dict[str, Any] = {"role": message.role}
        if message.content is not None:
            payload["content"] = message.content
        if message.tool_call_id is not None:
            payload["tool_call_id"] = message.tool_call_id
        if message.tool_calls is not None:
            payload["tool_calls"] = message.tool_calls
        if message.name is not None:
            payload["name"] = message.name
        return payload

    def _tool_to_dict(self, tool: ToolDefinition) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.parameters,
            },
        }

    async def _with_retry(self, operation: str, func: Callable[[], Awaitable[T]]) -> T:
        async for attempt in AsyncRetrying(
            stop=stop_after_attempt(3),
            wait=wait_exponential(multiplier=1, min=1, max=8),
            retry=retry_if_exception(self._is_retryable_error),
            reraise=True,
        ):
            with attempt:
                return await func()

        raise ProviderError(f"{operation} failed unexpectedly.", self.provider_type)

    def _raise_provider_error(self, operation: str, exc: Exception) -> ProviderError:
        self.logger.exception("provider_request_failed", operation=operation, error=str(exc))
        return ProviderError(f"{operation} failed: {exc}", self.provider_type)

    def _is_retryable_error(self, exc: BaseException) -> bool:
        if isinstance(exc, (APIConnectionError, APITimeoutError, RateLimitError)):
            return True
        return isinstance(exc, APIStatusError) and exc.status_code >= 500

    def _estimate_request_tokens(self, request: CompletionRequest) -> int:
        payload = {
            "messages": [self._message_to_dict(message) for message in request.messages],
            "tools": [self._tool_to_dict(tool) for tool in request.tools],
            "stop": request.stop,
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
            "extra": request.extra,
        }
        return self._estimate_tokens(request.model or self.default_model, payload)

    def _estimate_response_tokens(
        self,
        model: str,
        content: str | None,
        tool_calls: list[dict[str, Any]] | None,
    ) -> int:
        payload = {"content": content, "tool_calls": tool_calls}
        return self._estimate_tokens(model, payload)

    def _estimate_tokens(self, model: str, payload: Any) -> int:
        try:
            encoding = tiktoken.encoding_for_model(model)
        except KeyError:
            encoding = tiktoken.get_encoding("cl100k_base")

        return len(encoding.encode(json.dumps(payload, ensure_ascii=False, default=str)))

    def _coerce_content(self, content: Any) -> str | None:
        if content is None or isinstance(content, str):
            return content
        if isinstance(content, list):
            parts: list[str] = []
            for item in content:
                text = self._extract_text_part(item)
                if text:
                    parts.append(text)
            return "".join(parts) or None
        return str(content)

    def _extract_text_part(self, item: Any) -> str | None:
        if isinstance(item, str):
            return item
        if isinstance(item, dict):
            if item.get("type") == "text":
                return item.get("text")
            return item.get("content") or item.get("text")

        item_type = getattr(item, "type", None)
        if item_type == "text":
            text = getattr(item, "text", None)
            if isinstance(text, str):
                return text
            if text is not None:
                return getattr(text, "value", None)

        return getattr(item, "content", None)

    def _serialize_tool_calls(self, tool_calls: Any) -> list[dict[str, Any]] | None:
        if not tool_calls:
            return None

        serialized: list[dict[str, Any]] = []
        for tool_call in tool_calls:
            function = getattr(tool_call, "function", None)
            function_name = None
            function_arguments = None
            if function is not None:
                function_name = getattr(function, "name", None)
                function_arguments = getattr(function, "arguments", None)

            serialized_call: dict[str, Any] = {}
            index = getattr(tool_call, "index", None)
            if index is not None:
                serialized_call["index"] = index

            for key in ("id", "type"):
                value = getattr(tool_call, key, None)
                if value is not None:
                    serialized_call[key] = value

            function_payload: dict[str, Any] = {}
            if function_name is not None:
                function_payload["name"] = function_name
            if function_arguments is not None:
                function_payload["arguments"] = function_arguments
            if function_payload:
                serialized_call["function"] = function_payload

            if serialized_call:
                serialized.append(serialized_call)

        return serialized or None
