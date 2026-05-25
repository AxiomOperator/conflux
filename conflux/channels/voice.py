"""Voice channel — faster-whisper-server STT integration."""
import aiohttp
import structlog

from conflux.core.config import get_settings

logger = structlog.get_logger(__name__)


async def transcribe_audio(audio_data: bytes, filename: str = "audio.wav") -> str:
    """Transcribe audio using faster-whisper-server. Returns text."""
    settings = get_settings()
    form_data = aiohttp.FormData()
    form_data.add_field("file", audio_data, filename=filename, content_type="audio/wav")
    form_data.add_field("model", settings.whisper_model)
    form_data.add_field("response_format", "json")

    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"{settings.whisper_base_url}/v1/audio/transcriptions",
            data=form_data,
            timeout=aiohttp.ClientTimeout(total=60),
        ) as resp:
            resp.raise_for_status()
            data = await resp.json()
            return data.get("text", "").strip()


async def process_voice_message(
    audio_data: bytes,
    user_id: str,
    session_id: str | None = None,
) -> dict:
    """Full voice pipeline: STT → agent → response text."""
    settings = get_settings()
    transcribed = await transcribe_audio(audio_data)
    if not transcribed:
        return {"error": "Could not transcribe audio", "transcription": ""}

    logger.info("Voice transcribed", user_id=user_id, preview=transcribed[:100])

    import httpx

    async with httpx.AsyncClient(
        base_url=f"http://localhost:{settings.api_port}",
        headers={"X-Internal-Secret": settings.internal_api_secret},
        timeout=120,
    ) as client:
        resp = await client.post(
            "/v1/chat/completions",
            json={
                "model": "auto",
                "messages": [{"role": "user", "content": transcribed}],
            },
        )
        resp.raise_for_status()
        answer = resp.json()["choices"][0]["message"]["content"]

    return {"transcription": transcribed, "response": answer}
