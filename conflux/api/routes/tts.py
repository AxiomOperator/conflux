"""Text-to-speech via edge-tts (Microsoft Azure Neural voices)."""
from __future__ import annotations

import asyncio
import io

import structlog
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from conflux.api.auth import CurrentUser

logger = structlog.get_logger(__name__)

router = APIRouter()

# High-quality default voices for each gender
DEFAULT_VOICE = "en-US-AvaNeural"

# Curated set of voices to expose in the UI
AVAILABLE_VOICES: list[dict] = [
    {"id": "en-US-AvaNeural", "name": "Ava", "gender": "Female", "locale": "en-US"},
    {"id": "en-US-AndrewNeural", "name": "Andrew", "gender": "Male", "locale": "en-US"},
    {"id": "en-US-EmmaNeural", "name": "Emma", "gender": "Female", "locale": "en-US"},
    {"id": "en-US-BrianNeural", "name": "Brian", "gender": "Male", "locale": "en-US"},
    {"id": "en-US-AriaNeural", "name": "Aria", "gender": "Female", "locale": "en-US"},
    {"id": "en-US-ChristopherNeural", "name": "Christopher", "gender": "Male", "locale": "en-US"},
    {"id": "en-US-JennyNeural", "name": "Jenny", "gender": "Female", "locale": "en-US"},
    {"id": "en-US-GuyNeural", "name": "Guy", "gender": "Male", "locale": "en-US"},
    {"id": "en-GB-SoniaNeural", "name": "Sonia (UK)", "gender": "Female", "locale": "en-GB"},
    {"id": "en-GB-RyanNeural", "name": "Ryan (UK)", "gender": "Male", "locale": "en-GB"},
    {"id": "en-AU-NatashaNeural", "name": "Natasha (AU)", "gender": "Female", "locale": "en-AU"},
    {"id": "en-AU-WilliamNeural", "name": "William (AU)", "gender": "Male", "locale": "en-AU"},
]

VALID_VOICE_IDS = {v["id"] for v in AVAILABLE_VOICES}


class SpeakRequest(BaseModel):
    text: str
    voice: str = DEFAULT_VOICE
    rate: str = "+0%"   # e.g. "+20%" or "-10%"
    pitch: str = "+0Hz"


@router.get("/voices")
async def list_voices(_user: CurrentUser) -> list[dict]:
    """Return the curated list of available TTS voices."""
    return AVAILABLE_VOICES


@router.post("/speak")
async def speak(req: SpeakRequest, _user: CurrentUser) -> Response:
    """Synthesize text to speech and return MP3 audio."""
    try:
        import edge_tts  # lazy import — optional dependency
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="edge-tts is not installed. Run: pip install edge-tts",
        )

    if not req.text.strip():
        raise HTTPException(status_code=400, detail="text must not be empty")

    voice = req.voice if req.voice in VALID_VOICE_IDS else DEFAULT_VOICE

    try:
        communicate = edge_tts.Communicate(req.text, voice, rate=req.rate, pitch=req.pitch)
        buf = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                buf.write(chunk["data"])

        audio_bytes = buf.getvalue()
        if not audio_bytes:
            raise HTTPException(status_code=500, detail="No audio returned from TTS engine")

        return Response(
            content=audio_bytes,
            media_type="audio/mpeg",
            headers={"Cache-Control": "no-store"},
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("tts_speak_failed", error=str(exc))
        raise HTTPException(status_code=500, detail=f"TTS failed: {exc}") from exc
