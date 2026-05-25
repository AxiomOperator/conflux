from __future__ import annotations

from conflux.providers.openai_compat import OpenAICompatProvider


class OllamaProvider(OpenAICompatProvider):
    provider_type = "ollama"

    def __init__(self, base_url: str, default_model: str = "", api_key: str = "ollama"):
        super().__init__(base_url=base_url, api_key=api_key, default_model=default_model)
