from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class SettingDef:
    key: str
    category: str
    label: str
    description: str
    sensitive: bool = False
    setting_type: str = "string"
    env_attr: str = ""


SETTINGS_CATALOG: list[SettingDef] = [
    SettingDef("public_base_url", "core", "Public Base URL", "The public-facing URL of this Conflux instance", env_attr="public_base_url"),
    SettingDef("embedding_provider", "embeddings", "Embedding Provider", "Provider type (e.g. openai-compatible)", env_attr="embedding_provider"),
    SettingDef("embedding_model", "embeddings", "Embedding Model", "Model name for embeddings", env_attr="embedding_model"),
    SettingDef("embedding_base_url", "embeddings", "Embedding Base URL", "Base URL of the embedding API", env_attr="embedding_base_url"),
    SettingDef("embedding_api_key", "embeddings", "Embedding API Key", "API key for the embedding service", sensitive=True, env_attr="embedding_api_key"),
    SettingDef("embedding_dimensions", "embeddings", "Embedding Dimensions", "Vector dimensions (must match model)", setting_type="int", env_attr="embedding_dimensions"),
    SettingDef("searxng_url", "search", "SearXNG URL", "Base URL of the SearXNG instance", env_attr="searxng_url"),
    SettingDef("searxng_timeout_ms", "search", "SearXNG Timeout (ms)", "Search timeout in milliseconds", setting_type="int", env_attr="searxng_timeout_ms"),
    SettingDef("whisper_base_url", "voice", "Whisper Base URL", "Base URL of the faster-whisper-server", env_attr="whisper_base_url"),
    SettingDef("whisper_model", "voice", "Whisper Model", "STT model name", env_attr="whisper_model"),
    SettingDef("telegram_bot_token", "messaging", "Telegram Bot Token", "Token from @BotFather", sensitive=True, env_attr="telegram_bot_token"),
    SettingDef("telegram_allowed_user_ids", "messaging", "Telegram Allowed User IDs", "Telegram user IDs allowed to use the bot", setting_type="list", env_attr="telegram_allowed_user_ids"),
    SettingDef("telegram_webhook_secret", "messaging", "Telegram Webhook Secret", "Webhook validation secret", sensitive=True, env_attr="telegram_webhook_secret"),
    SettingDef("telegram_mode", "messaging", "Telegram Mode", "polling or webhook", env_attr="telegram_mode"),
    SettingDef("agentmail_api_key", "messaging", "AgentMail API Key", "API key for agentmail.to", sensitive=True, env_attr="agentmail_api_key"),
    SettingDef("agentmail_api_url", "messaging", "AgentMail API URL", "AgentMail API base URL", env_attr="agentmail_api_url"),
    SettingDef("data_guard_enabled", "features", "Data Guard", "Block destructive operations in dev/test", setting_type="bool", env_attr="data_guard_enabled"),
    SettingDef("wiki_rag_enabled_default", "features", "Wiki RAG Default", "Enable wiki RAG for new agents by default", setting_type="bool", env_attr="wiki_rag_enabled_default"),
    SettingDef("skills_api_key", "integrations", "Skills Marketplace API Key", "Key for the SkillsMP marketplace", sensitive=True, env_attr="skills_api_key"),
    SettingDef("skillsmp_base_url", "integrations", "Skills Marketplace URL", "Base URL of the SkillsMP API", env_attr="skillsmp_base_url"),
    SettingDef("synapse_url", "integrations", "Synapse URL", "URL of the Synapse graph visualization tool", env_attr="synapse_url"),
]

SETTINGS_BY_KEY = {setting.key: setting for setting in SETTINGS_CATALOG}
