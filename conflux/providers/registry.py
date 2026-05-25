from __future__ import annotations

import asyncio
from typing import Any

import structlog

from conflux.providers.base import AbstractLLMProvider

LOGGER = structlog.get_logger(__name__)

# Maps provider_type strings (stored in DB) to provider classes.
_PROVIDER_TYPE_MAP: dict[str, type] = {}


def _build_type_map() -> dict[str, type]:
    global _PROVIDER_TYPE_MAP
    if _PROVIDER_TYPE_MAP:
        return _PROVIDER_TYPE_MAP
    try:
        from conflux.providers.llamacpp import LlamaCppProvider
        from conflux.providers.lmstudio import LMStudioProvider
        from conflux.providers.ollama import OllamaProvider
        from conflux.providers.openai_compat import OpenAICompatProvider
        from conflux.providers.vllm import VLLMProvider

        _PROVIDER_TYPE_MAP = {
            "ollama": OllamaProvider,
            "vllm": VLLMProvider,
            "llamacpp": LlamaCppProvider,
            "lmstudio": LMStudioProvider,
            "openai_compat": OpenAICompatProvider,
        }
    except ImportError as exc:
        LOGGER.warning("provider_type_map_incomplete", error=str(exc))
    return _PROVIDER_TYPE_MAP


class ProviderRegistry:
    """Manages all configured LLM providers loaded from the database."""

    def __init__(self):
        self._providers: dict[str, AbstractLLMProvider] = {}
        self._default_provider: str | None = None
        self._embedding_provider: Any | None = None

    def register(self, name: str, provider: AbstractLLMProvider, set_default: bool = False) -> None:
        self._providers[name] = provider
        if set_default or self._default_provider is None:
            self._default_provider = name
        LOGGER.info("provider_registered", name=name, provider_type=provider.provider_type)

    def get(self, name: str) -> AbstractLLMProvider:
        try:
            return self._providers[name]
        except KeyError as exc:
            raise KeyError(f"Provider '{name}' not found.") from exc

    def get_default(self) -> AbstractLLMProvider:
        if self._default_provider is None:
            raise KeyError("No providers loaded. Run refresh_provider_registry() first.")
        return self.get(self._default_provider)

    def get_default_model_name(self) -> str:
        return getattr(self.get_default(), "default_model", "")

    def list_providers(self) -> list[dict[str, Any]]:
        return [
            {
                "name": name,
                "type": provider.provider_type,
                "default_model": getattr(provider, "default_model", ""),
            }
            for name, provider in self._providers.items()
        ]

    async def health_check_all(self) -> dict[str, bool]:
        async def _check(name: str, provider: AbstractLLMProvider) -> tuple[str, bool]:
            try:
                return name, await provider.health_check()
            except Exception as exc:
                LOGGER.warning("provider_health_check_failed", name=name, error=str(exc))
                return name, False

        results = await asyncio.gather(
            *(_check(name, provider) for name, provider in self._providers.items())
        )
        return dict(results)

    def get_embedding_provider(self) -> Any:
        if self._embedding_provider is None:
            raise KeyError("No embedding provider configured.")
        return self._embedding_provider

    @classmethod
    async def from_db_async(cls) -> "ProviderRegistry":
        """Load all enabled providers from the `providers` table."""
        from sqlalchemy import select

        from conflux.core.config import get_settings
        from conflux.core.database import get_db_session
        from conflux.models.provider import Provider, ProviderModel

        registry = cls()
        type_map = _build_type_map()

        try:
            async with get_db_session() as db:
                result = await db.execute(
                    select(Provider).where(Provider.is_enabled.is_(True)).order_by(Provider.created_at)
                )
                providers = result.scalars().all()

                for row in providers:
                    provider_cls = type_map.get(row.provider_type)
                    if provider_cls is None:
                        LOGGER.warning(
                            "unknown_provider_type",
                            name=row.name,
                            provider_type=row.provider_type,
                        )
                        continue

                    # First enabled model becomes default_model for this provider
                    model_result = await db.execute(
                        select(ProviderModel.model_name)
                        .where(
                            ProviderModel.provider_id == row.id,
                            ProviderModel.is_enabled.is_(True),
                        )
                        .order_by(ProviderModel.created_at)
                        .limit(1)
                    )
                    model_row = model_result.first()
                    default_model = model_row[0] if model_row else ""

                    instance = provider_cls(
                        base_url=row.base_url,
                        api_key=row.api_key or "none",
                        default_model=default_model,
                    )
                    registry.register(row.name, instance)

        except Exception as exc:
            LOGGER.error("failed_to_load_providers_from_db", error=str(exc))

        # Embedding provider always comes from settings (not DB)
        try:
            from conflux.core.config import get_settings
            from conflux.providers.embeddings import EmbeddingProvider

            settings = get_settings()
            if settings.embedding_base_url and settings.embedding_model:
                registry._embedding_provider = EmbeddingProvider(
                    base_url=settings.embedding_base_url,
                    model=settings.embedding_model,
                    api_key=settings.embedding_api_key,
                )
        except Exception as exc:
            LOGGER.warning("embedding_provider_setup_failed", error=str(exc))

        LOGGER.info(
            "provider_registry_loaded",
            count=len(registry._providers),
            default=registry._default_provider,
        )
        return registry


# ── Global registry singleton ─────────────────────────────────────────────────

_registry: ProviderRegistry | None = None


def get_provider_registry() -> ProviderRegistry:
    """Return the global registry. Empty until refresh_provider_registry() is called."""
    global _registry
    if _registry is None:
        _registry = ProviderRegistry()
    return _registry


async def refresh_provider_registry() -> ProviderRegistry:
    """Reload all providers from DB and replace the global registry."""
    global _registry
    new_registry = await ProviderRegistry.from_db_async()
    _registry = new_registry
    return new_registry
