from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import AnyHttpUrl, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Environment ──────────────────────────────────────────────────────────
    environment: Literal["development", "production", "test"] = "development"
    log_level: str = "info"
    public_base_url: str = "http://localhost:3000"
    data_guard_enabled: bool = False
    wiki_rag_enabled_default: bool = True

    # ── Database ─────────────────────────────────────────────────────────────
    database_url: str

    # ── DragonflyDB (Redis-compatible) ───────────────────────────────────────
    dragonfly_url: str = "redis://localhost:6379"
    dragonfly_password: str = ""

    # ── Qdrant ───────────────────────────────────────────────────────────────
    qdrant_url: str = "http://localhost:6333"
    qdrant_api_key: str = ""
    qdrant_collection_documents: str = "conflux_documents"
    qdrant_collection_memory: str = "conflux_memory"
    qdrant_collection_skills: str = "conflux_skills"
    qdrant_collection_wiki: str = "conflux_wiki"

    # ── Embeddings ───────────────────────────────────────────────────────────
    embedding_provider: str = "openai-compatible"
    embedding_model: str = "Qwen3-Embedding-8B-f16.gguf"
    embedding_base_url: str = "http://localhost:8082/v1"
    embedding_api_key: str = ""
    embedding_dimensions: int = 4096

    # ── SearXNG ──────────────────────────────────────────────────────────────
    searxng_url: str = "http://localhost:8080"
    searxng_timeout_ms: int = 15000

    # ── SkillsMP marketplace ──────────────────────────────────────────────────
    skills_api_key: str = ""
    skillsmp_base_url: str = "https://skillsmp.com/api/v1"

    # ── Voice / STT ──────────────────────────────────────────────────────────
    whisper_base_url: str = "http://localhost:8000"
    whisper_model: str = "base"

    # ── AgentMail ─────────────────────────────────────────────────────────────
    agentmail_api_key: str = ""
    agentmail_api_url: str = "https://api.agentmail.to/v0/"

    # ── Auth ─────────────────────────────────────────────────────────────────
    jwt_secret: str
    api_key_pepper: str
    jwt_expiry: str = "7d"

    # ── Microsoft Entra ID (Azure AD) ────────────────────────────────────────
    azure_ad_client_id: str = ""
    azure_ad_client_secret: str = ""
    azure_ad_tenant_id: str = ""
    nextauth_secret: str = ""
    nextauth_url: str = "https://conflux.example.com"
    nextauth_api_url: str = "http://localhost:3000/v1"
    synapse_url: str = ""  # e.g. https://synapse.example.com — added to CORS allowed origins
    internal_api_secret: str = ""

    # ── Telegram ─────────────────────────────────────────────────────────────
    telegram_bot_token: str = ""
    telegram_allowed_user_ids: str = ""
    telegram_webhook_secret: str = ""
    telegram_mode: Literal["polling", "webhook"] = "polling"

    # ── Filesystem ───────────────────────────────────────────────────────────
    conflux_home: str = "./.conflux"
    skills_dir: str = "./skills"
    workspace_root: str = "./workspace"

    # ── API Server ───────────────────────────────────────────────────────────
    api_host: str = "0.0.0.0"
    api_port: int = 3000

    @field_validator("database_url")
    @classmethod
    def ensure_asyncpg_driver(cls, v: str) -> str:
        """Ensure the database URL uses the asyncpg driver."""
        if v.startswith("postgresql://") and "asyncpg" not in v:
            return v.replace("postgresql://", "postgresql+asyncpg://", 1)
        return v

    @property
    def telegram_allowed_ids(self) -> list[int]:
        if not self.telegram_allowed_user_ids:
            return []
        return [int(uid.strip()) for uid in self.telegram_allowed_user_ids.split(",") if uid.strip()]

    @property
    def is_dev(self) -> bool:
        return self.environment == "development"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
