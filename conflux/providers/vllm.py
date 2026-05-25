from __future__ import annotations

from conflux.providers.openai_compat import OpenAICompatProvider


class VLLMProvider(OpenAICompatProvider):
    provider_type = "vllm"

    def __init__(self, base_url: str, default_model: str = "", api_key: str = "vllm"):
        super().__init__(base_url=base_url, api_key=api_key, default_model=default_model)
