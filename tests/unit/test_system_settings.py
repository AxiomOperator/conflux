from __future__ import annotations

import pytest

from conflux.api.routes import system_settings as route_settings
from conflux.services import system_settings as svc
from conflux.services.settings_catalog import SETTINGS_BY_KEY


def test_normalize_setting_input_canonicalizes_bool_and_int() -> None:
    assert svc.normalize_setting_input('data_guard_enabled', 'YES') == 'true'
    assert svc.normalize_setting_input('embedding_dimensions', '3072') == '3072'


def test_normalize_setting_input_rejects_invalid_bool() -> None:
    with pytest.raises(ValueError):
        svc.normalize_setting_input('data_guard_enabled', 'maybe')


def test_build_setting_out_preserves_false_env_values(monkeypatch: pytest.MonkeyPatch) -> None:
    definition = SETTINGS_BY_KEY['data_guard_enabled']
    monkeypatch.setattr(route_settings.svc, 'get_default_setting_value', lambda _key: False)

    setting = route_settings._build_setting_out(definition, {})

    assert setting.env_value == 'false'
    assert setting.effective_value == 'false'
    assert setting.has_db_override is False


def test_build_setting_out_masks_sensitive_values(monkeypatch: pytest.MonkeyPatch) -> None:
    definition = SETTINGS_BY_KEY['agentmail_api_key']
    monkeypatch.setattr(route_settings.svc, 'get_default_setting_value', lambda _key: 'env-secret')

    setting = route_settings._build_setting_out(definition, {'agentmail_api_key': 'db-secret'})

    assert setting.env_value == '***'
    assert setting.db_value == '***'
    assert setting.effective_value == '***'
    assert setting.has_db_override is True
