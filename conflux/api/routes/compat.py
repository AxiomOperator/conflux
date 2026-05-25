"""OpenAI-compatible endpoint."""
import json
import time
from uuid import uuid4

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from conflux.api.auth import CurrentUser

router = APIRouter()


class CompatMessage(BaseModel):
    role: str
    content: str


class CompatRequest(BaseModel):
    model: str = 'auto'
    messages: list[CompatMessage]
    stream: bool = False
    temperature: float = 0.7


@router.post('/chat/completions')
async def chat_completions(body: CompatRequest, user: CurrentUser):
    from conflux.agents.base import RunContext
    from conflux.agents.orchestrator import OrchestratorAgent

    run_id = str(uuid4())
    created = int(time.time())
    agent = OrchestratorAgent()
    if body.model != 'auto':
        agent.config.model_policy['model'] = body.model
    agent.config.model_policy['temperature'] = body.temperature

    context = RunContext(
        run_id=run_id,
        user_id=user.user_id,
        session_id=None,
        tenant_id=user.tenant_id,
        project_id=None,
        input_messages=[
            {'role': message.role, 'content': message.content}
            for message in body.messages
        ],
    )

    if body.stream:
        async def stream_chunks():
            yield (
                'data: '
                + json.dumps(
                    {
                        'id': f'chatcmpl-{run_id}',
                        'object': 'chat.completion.chunk',
                        'created': created,
                        'model': body.model,
                        'choices': [
                            {'index': 0, 'delta': {'role': 'assistant'}, 'finish_reason': None}
                        ],
                    }
                )
                + '\n\n'
            )

            async for event in agent.create_loop(context).run():
                if event.event_type == 'token':
                    yield (
                        'data: '
                        + json.dumps(
                            {
                                'id': f'chatcmpl-{run_id}',
                                'object': 'chat.completion.chunk',
                                'created': created,
                                'model': body.model,
                                'choices': [
                                    {
                                        'index': 0,
                                        'delta': {'content': event.data.get('content', '')},
                                        'finish_reason': None,
                                    }
                                ],
                            }
                        )
                        + '\n\n'
                    )
                elif event.event_type == 'done':
                    yield (
                        'data: '
                        + json.dumps(
                            {
                                'id': f'chatcmpl-{run_id}',
                                'object': 'chat.completion.chunk',
                                'created': created,
                                'model': body.model,
                                'choices': [
                                    {'index': 0, 'delta': {}, 'finish_reason': 'stop'}
                                ],
                            }
                        )
                        + '\n\n'
                    )
                    break
            yield 'data: [DONE]\n\n'

        return StreamingResponse(stream_chunks(), media_type='text/event-stream')

    full_content = ''
    async for event in agent.create_loop(context).run():
        if event.event_type == 'done':
            full_content = event.data.get('content', '')
            break

    return {
        'id': f'chatcmpl-{run_id}',
        'object': 'chat.completion',
        'created': created,
        'model': body.model,
        'choices': [
            {
                'index': 0,
                'message': {'role': 'assistant', 'content': full_content},
                'finish_reason': 'stop',
            }
        ],
        'usage': {'prompt_tokens': 0, 'completion_tokens': 0, 'total_tokens': 0},
    }
