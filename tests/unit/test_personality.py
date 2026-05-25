from __future__ import annotations

import pytest

from conflux.api.routes.personality import (
    format_personality_confirmation,
    format_personality_presets_message,
    get_personality_instruction,
    parse_personality_preset,
)


@pytest.mark.parametrize(
    ('raw_preset', 'expected'),
    [
        ('concise', 'concise'),
        ('Concise', 'concise'),
        (' technical ', 'technical'),
        ('balanced', None),
        (None, None),
    ],
)
def test_parse_personality_preset_normalizes_values(raw_preset, expected):
    assert parse_personality_preset(raw_preset) == expected


def test_parse_personality_preset_rejects_unknown_value():
    with pytest.raises(ValueError):
        parse_personality_preset('mysterious')


def test_personality_instruction_and_confirmation_messages():
    assert get_personality_instruction('friendly') == (
        'Personality: Be warm and encouraging. Use casual language.'
    )
    assert format_personality_confirmation(None) == (
        'Personality reset to Balanced. Future responses will use the default adaptive style.'
    )


def test_personality_presets_message_marks_current_and_default():
    message = format_personality_presets_message('creative')

    assert '`creative`' in message
    assert '(current)' in message
    assert '`balanced`' in message
    assert '(default)' in message
    assert '/personality <preset>' in message
