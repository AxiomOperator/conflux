from __future__ import annotations

import asyncio

from conflux.agents.base import AgentConfig, RunContext
from conflux.agents.loop import AgentLoop


def _make_loop(messages: list[dict[str, str]]) -> AgentLoop:
    return AgentLoop(
        config=AgentConfig(
            agent_id='agent-id',
            name='Test Agent',
            agent_type='worker',
            system_prompt='Base prompt',
            model_policy={},
            tool_allowlist=[],
            retrieval_tags=[],
        ),
        context=RunContext(
            run_id='run-id',
            user_id='user-id',
            session_id=None,
            tenant_id=None,
            project_id=None,
            input_messages=messages,
        ),
    )


def test_get_query_for_rag_prefers_latest_user_message() -> None:
    loop = _make_loop(
        [
            {'role': 'system', 'content': 'ignore me'},
            {'role': 'user', 'content': 'first question'},
            {'role': 'assistant', 'content': 'response'},
            {'role': 'user', 'content': 'latest question'},
        ]
    )

    assert loop._get_query_for_rag() == 'latest question'


def test_build_system_prompt_appends_wiki_block_after_other_context(monkeypatch) -> None:
    loop = _make_loop([{'role': 'user', 'content': 'question'}])

    async def fake_persona() -> str:
        return 'persona'

    async def fake_memories() -> str:
        return 'memories'

    async def fake_skills() -> str:
        return 'skills'

    async def fake_wiki() -> str:
        return '## Relevant Wiki Pages\n\n### Page\nSnippet'

    monkeypatch.setattr(loop, '_fetch_persona_block', fake_persona)
    monkeypatch.setattr(loop, '_fetch_memories_block', fake_memories)
    monkeypatch.setattr(loop, '_fetch_skills_block', fake_skills)
    monkeypatch.setattr(loop, '_fetch_wiki_block', fake_wiki)

    prompt = asyncio.run(loop._build_system_prompt())

    assert prompt == '\n\n'.join(
        [
            'persona',
            'Base prompt',
            'memories',
            'skills',
            '## Relevant Wiki Pages\n\n### Page\nSnippet',
        ]
    )
