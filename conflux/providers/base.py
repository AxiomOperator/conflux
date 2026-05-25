from __future__ import annotations

"""Abstract LLM provider interface."""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import AsyncIterator


class ProviderError(Exception):
    """Raised when a provider request fails."""

    def __init__(self, message: str, provider_name: str):
        self.message = message
        self.provider_name = provider_name
        super().__init__(f"{provider_name}: {message}")


@dataclass
class ChatMessage:
    role: str
    content: str | None = None
    tool_call_id: str | None = None
    tool_calls: list[dict] | None = None
    name: str | None = None


@dataclass
class ToolDefinition:
    name: str
    description: str
    parameters: dict


@dataclass
class CompletionRequest:
    messages: list[ChatMessage]
    model: str
    tools: list[dict] = field(default_factory=list)  # OpenAI function-calling format
    temperature: float = 0.7
    max_tokens: int | None = None
    stream: bool = False
    stop: list[str] | None = None
    extra: dict = field(default_factory=dict)


@dataclass
class CompletionChunk:
    """A single streaming chunk."""

    delta_content: str | None = None
    delta_tool_calls: list[dict] | None = None
    finish_reason: str | None = None
    usage: dict | None = None  # prompt_tokens / completion_tokens / total_tokens


@dataclass
class CompletionResponse:
    content: str | None
    tool_calls: list[dict] | None
    finish_reason: str
    model: str
    input_tokens: int
    output_tokens: int
    total_tokens: int


class AbstractLLMProvider(ABC):
    provider_type: str = ""

    @abstractmethod
    async def complete(self, request: CompletionRequest) -> CompletionResponse: ...

    @abstractmethod
    async def stream(self, request: CompletionRequest) -> AsyncIterator[CompletionChunk]: ...

    @abstractmethod
    async def list_models(self) -> list[str]: ...

    @abstractmethod
    async def health_check(self) -> bool: ...
