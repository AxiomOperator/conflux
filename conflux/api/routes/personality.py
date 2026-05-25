"""Personality preset routes and helpers."""
from __future__ import annotations

import uuid as _uuid
from uuid import UUID

from fastapi import APIRouter
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select

from conflux.api.auth import CurrentUser
from conflux.api.deps import DB
from conflux.models.user import UserPersonaFiles

router = APIRouter()

DEFAULT_PERSONALITY_PRESET = 'balanced'
PERSONALITY_PRESETS: tuple[dict[str, str], ...] = (
    {
        'name': 'concise',
        'label': 'Concise',
        'description': 'Terse and direct. No fluff, no filler.',
        'example': '3 steps: 1) ... 2) ... 3) ...',
    },
    {
        'name': 'creative',
        'label': 'Creative',
        'description': 'Exploratory and imaginative. Uses analogies and metaphors.',
        'example': 'Think of it like...',
    },
    {
        'name': 'technical',
        'label': 'Technical',
        'description': 'Precise and code-first. Assumes expertise.',
        'example': 'The root cause is...',
    },
    {
        'name': 'friendly',
        'label': 'Friendly',
        'description': 'Warm and encouraging. Uses casual language.',
        'example': "Great question! Here's...",
    },
    {
        'name': 'formal',
        'label': 'Formal',
        'description': 'Professional and structured. Complete sentences.',
        'example': 'Upon analysis, the...',
    },
    {
        'name': DEFAULT_PERSONALITY_PRESET,
        'label': 'Balanced',
        'description': 'Well-rounded and adaptive.',
        'example': "Here's how I'd approach...",
    },
)
PERSONALITY_PRESET_MAP = {preset['name']: preset for preset in PERSONALITY_PRESETS}
PERSONALITY_PROMPT_INSTRUCTIONS = {
    'concise': 'Personality: Be terse and direct. No filler. Short responses.',
    'creative': 'Personality: Be exploratory and imaginative. Use analogies.',
    'technical': 'Personality: Be precise and code-first. Assume expertise.',
    'friendly': 'Personality: Be warm and encouraging. Use casual language.',
    'formal': 'Personality: Be professional and structured.',
}
PERSONALITY_CONFIRMATIONS = {
    'concise': 'Personality set to Concise. Future responses will be terse and direct.',
    'creative': 'Personality set to Creative. Future responses will be more exploratory and imaginative.',
    'technical': 'Personality set to Technical. Future responses will stay precise and code-first.',
    'friendly': 'Personality set to Friendly. Future responses will be warmer and more encouraging.',
    'formal': 'Personality set to Formal. Future responses will be professional and structured.',
}


class PersonalityPresetOption(BaseModel):
    name: str
    label: str
    description: str
    example: str


class PersonalityResponse(BaseModel):
    preset: str | None
    presets: list[PersonalityPresetOption]


class PersonalityUpdate(BaseModel):
    preset: str | None = Field(default=None)

    @field_validator('preset', mode='before')
    @classmethod
    def validate_preset(cls, value: object) -> str | None:
        return parse_personality_preset(value)


def normalize_personality_preset(preset: str | None) -> str | None:
    if preset is None:
        return None
    normalized = str(preset).strip().lower()
    if not normalized or normalized == DEFAULT_PERSONALITY_PRESET:
        return None
    if normalized not in PERSONALITY_PROMPT_INSTRUCTIONS:
        return None
    return normalized


def parse_personality_preset(value: object) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip().lower()
    if not normalized or normalized == DEFAULT_PERSONALITY_PRESET:
        return None
    if normalized not in PERSONALITY_PRESET_MAP:
        valid = ', '.join(preset['name'] for preset in PERSONALITY_PRESETS)
        raise ValueError(f'Invalid preset. Choose one of: {valid}')
    return normalized


def get_personality_instruction(preset: str | None) -> str:
    normalized = normalize_personality_preset(preset)
    if not normalized:
        return ''
    return PERSONALITY_PROMPT_INSTRUCTIONS.get(normalized, '')


def format_personality_confirmation(preset: str | None) -> str:
    normalized = normalize_personality_preset(preset)
    if not normalized:
        return 'Personality reset to Balanced. Future responses will use the default adaptive style.'
    return PERSONALITY_CONFIRMATIONS[normalized]


def format_personality_presets_message(current_preset: str | None) -> str:
    normalized_current = normalize_personality_preset(current_preset)
    lines = ['Available personality presets:']
    for preset in PERSONALITY_PRESETS:
        is_current = (
            preset['name'] == DEFAULT_PERSONALITY_PRESET
            if normalized_current is None
            else preset['name'] == normalized_current
        )
        tags = []
        if preset['name'] == DEFAULT_PERSONALITY_PRESET:
            tags.append('default')
        if is_current:
            tags.append('current')
        suffix = f" ({', '.join(tags)})" if tags else ''
        lines.append(
            f"- `{preset['name']}` — {preset['label']}: {preset['description']} Example: {preset['example']}{suffix}"
        )
    lines.append('')
    lines.append('Use `/personality <preset>` to switch styles, or `/personality balanced` to reset.')
    return '\n'.join(lines)


def _build_personality_response(preset: str | None) -> PersonalityResponse:
    return PersonalityResponse(
        preset=normalize_personality_preset(preset),
        presets=[PersonalityPresetOption(**item) for item in PERSONALITY_PRESETS],
    )


async def get_user_personality_preset(db: DB, user_id: UUID) -> str | None:
    result = await db.execute(
        select(UserPersonaFiles.personality_preset).where(UserPersonaFiles.user_id == user_id)
    )
    return normalize_personality_preset(result.scalar_one_or_none())


async def set_user_personality_preset(db: DB, user_id: UUID, preset: str | None) -> str | None:
    normalized = normalize_personality_preset(preset)
    result = await db.execute(
        select(UserPersonaFiles).where(UserPersonaFiles.user_id == user_id)
    )
    persona = result.scalar_one_or_none()
    if not persona:
        persona = UserPersonaFiles(id=_uuid.uuid4(), user_id=user_id)
        db.add(persona)
    persona.personality_preset = normalized
    await db.flush()
    return normalized


@router.get('/personality', response_model=PersonalityResponse)
async def get_personality(db: DB, user: CurrentUser):
    preset = await get_user_personality_preset(db, UUID(user.user_id))
    return _build_personality_response(preset)


@router.post('/personality', response_model=PersonalityResponse)
async def update_personality(body: PersonalityUpdate, db: DB, user: CurrentUser):
    preset = await set_user_personality_preset(db, UUID(user.user_id), body.preset)
    return _build_personality_response(preset)
