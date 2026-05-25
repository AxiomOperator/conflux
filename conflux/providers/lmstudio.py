from __future__ import annotations

from conflux.providers.openai_compat import OpenAICompatProvider


class LMStudioProvider(OpenAICompatProvider):
    provider_type = "lmstudio"

    def __init__(self, base_url: str, default_model: str = "", api_key: str = "lm-studio"):
        super().__init__(base_url=base_url, api_key=api_key, default_model=default_model)
