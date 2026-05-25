from __future__ import annotations

from types import SimpleNamespace

import pytest

import conflux.core.config as config_module
import conflux.services.audit as audit_module
from conflux.agents.base import RunContext
from conflux.services.audit import _truncate
from conflux.tools.registry import ToolDefinition, ToolRegistry


def _make_context() -> RunContext:
    return RunContext(
        run_id='run-123',
        user_id='user-123',
        session_id='session-123',
        tenant_id=None,
        project_id=None,
    )


def test_truncate_limits_preview_length() -> None:
    preview = _truncate({'payload': 'x' * 2000}, max_len=30)

    assert preview.startswith('{"payload": "xxxxxxxxxxxxxxxxx')
    assert 'chars truncated' in preview


@pytest.mark.asyncio
async def test_tool_registry_logs_successful_tool_call(monkeypatch: pytest.MonkeyPatch) -> None:
    events: list[dict] = []

    async def fake_tool(args: dict, context: RunContext) -> dict:
        return {'ok': True, 'args': args, 'run_id': context.run_id}

    monkeypatch.setattr(config_module, 'get_settings', lambda: SimpleNamespace(data_guard_enabled=False))
    monkeypatch.setattr(audit_module, 'log_audit_event', lambda **kwargs: events.append(kwargs))

    registry = ToolRegistry()
    registry.register(
        ToolDefinition(
            name='echo',
            description='echo tool',
            parameters={},
            risk_level='safe',
            fn=fake_tool,
        )
    )

    result = await registry.execute('echo', {'value': 7}, _make_context())

    assert result == {'ok': True, 'args': {'value': 7}, 'run_id': 'run-123'}
    assert len(events) == 1
    assert events[0]['event_type'] == 'tool_call'
    assert events[0]['tool_name'] == 'echo'
    assert events[0]['agent_run_id'] == 'run-123'
    assert events[0]['user_id'] == 'user-123'
    assert events[0]['session_id'] == 'session-123'
    assert events[0]['error_message'] is None
    assert '"value": 7' in events[0]['args_preview']
    assert '"ok": true' in events[0]['result_preview']
    assert events[0]['duration_ms'] is not None
    assert events[0]['duration_ms'] >= 0


@pytest.mark.asyncio
async def test_tool_registry_logs_shell_failure_stderr(monkeypatch: pytest.MonkeyPatch) -> None:
    events: list[dict] = []

    async def fake_shell(_args: dict, _context: RunContext) -> dict:
        return {'stdout': '', 'stderr': 'permission denied', 'returncode': 1}

    monkeypatch.setattr(config_module, 'get_settings', lambda: SimpleNamespace(data_guard_enabled=False))
    monkeypatch.setattr(audit_module, 'log_audit_event', lambda **kwargs: events.append(kwargs))

    registry = ToolRegistry()
    registry.register(
        ToolDefinition(
            name='shell_exec',
            description='shell tool',
            parameters={},
            risk_level='safe',
            fn=fake_shell,
        )
    )

    result = await registry.execute('shell_exec', {'command': 'rm -rf /'}, _make_context())

    assert result['returncode'] == 1
    assert len(events) == 1
    assert events[0]['event_type'] == 'shell_command'
    assert events[0]['error_message'] == 'permission denied'
    assert '"command": "rm -rf /"' in events[0]['args_preview']


@pytest.mark.asyncio
async def test_tool_registry_logs_exceptions_as_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    events: list[dict] = []

    async def exploding_tool(_args: dict, _context: RunContext) -> dict:
        raise RuntimeError('boom')

    monkeypatch.setattr(config_module, 'get_settings', lambda: SimpleNamespace(data_guard_enabled=False))
    monkeypatch.setattr(audit_module, 'log_audit_event', lambda **kwargs: events.append(kwargs))

    registry = ToolRegistry()
    registry.register(
        ToolDefinition(
            name='explode',
            description='failing tool',
            parameters={},
            risk_level='safe',
            fn=exploding_tool,
        )
    )

    result = await registry.execute('explode', {'value': 1}, _make_context())

    assert result == {'error': 'boom'}
    assert len(events) == 1
    assert events[0]['event_type'] == 'error'
    assert events[0]['tool_name'] == 'explode'
    assert events[0]['result_preview'] is None
    assert events[0]['error_message'] == 'boom'
    assert events[0]['duration_ms'] is not None
    assert events[0]['duration_ms'] >= 0
