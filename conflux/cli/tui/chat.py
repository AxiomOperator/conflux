"""Interactive Rich chat UI for Conflux agent runs."""
from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import httpx
from rich.console import Console, Group
from rich.live import Live
from rich.markdown import Markdown
from rich.padding import Padding
from rich.panel import Panel
from rich.prompt import Prompt
from rich.rule import Rule
from rich.style import Style
from rich.text import Text

from conflux.cli.tui.theme import THEME
from conflux.cli.tui.utils import make_client, safe_get, truncate

console = Console(theme=THEME)
TOOL_STYLE = Style(color="yellow", dim=True)


async def run_chat(
    agent_id: str,
    api_url: str,
    api_key: str,
    initial_message: str | None = None,
) -> None:
    """Run an interactive streaming chat session against a Conflux agent."""
    async with make_client(api_url, api_key, timeout=300.0) as client:
        agent = await _fetch_agent(client, agent_id)
        if agent is None:
            return

        _print_header(agent)
        history: list[dict[str, str]] = []

        if initial_message is not None:
            message = initial_message.strip()
            if not message:
                console.print("[warn]No message provided.[/warn]")
                return
            history.append({"role": "user", "content": message})
            await _run_turn(client, agent_id, history, message)
            return

        while True:
            try:
                message = Prompt.ask("[bold cyan]You[/bold cyan]").strip()
            except (EOFError, KeyboardInterrupt):
                console.print("\n[muted]Exiting chat.[/muted]")
                return

            if message.lower() in {"quit", "exit", "q"}:
                console.print("[muted]Exiting chat.[/muted]")
                return
            if not message:
                continue

            history.append({"role": "user", "content": message})
            await _run_turn(client, agent_id, history, message)


async def _fetch_agent(client: httpx.AsyncClient, agent_id: str) -> dict[str, Any] | None:
    try:
        resp = await client.get(f"/v1/agents/{agent_id}")
        if resp.status_code == 401:
            console.print(
                "[error]Authentication required.[/error]\n"
                "[muted]Set [bold]CONFLUX_API_KEY[/bold] env var or use [bold]--api-key[/bold].\n"
                "Generate a key in Conflux UI → Settings → API Keys.[/muted]"
            )
            return None
        if resp.status_code == 404:
            console.print(
                f"[error]Agent '{agent_id}' was not found.[/error] "
                "[muted]Use 'conflux agent list' to find a valid agent id.[/muted]"
            )
            return None
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPError as exc:
        console.print(f"[error]Failed to load agent details:[/error] {_describe_http_error(exc)}")
        return None


async def _run_turn(
    client: httpx.AsyncClient,
    agent_id: str,
    history: list[dict[str, str]],
    user_message: str,
) -> None:
    console.print()
    console.print(_message_panel({"role": "user", "content": user_message}))

    response_text, tool_events, stream_error = await _stream_response(client, agent_id, history)

    if response_text:
        history.append({"role": "assistant", "content": response_text})

    if tool_events:
        for renderable in tool_events:
            console.print(renderable)

    console.print(_message_panel({"role": "assistant", "content": response_text}))

    if stream_error:
        console.print(
            Panel(
                Text(stream_error, style="error"),
                title="[bold red]Stream Error[/bold red]",
                border_style="red",
            )
        )


async def _stream_response(
    client: httpx.AsyncClient,
    agent_id: str,
    history: list[dict[str, str]],
) -> tuple[str, list[Any], str | None]:
    try:
        create_resp = await client.post(
            "/v1/runs",
            json={"agent_id": agent_id, "messages": history, "stream": True},
        )
        create_resp.raise_for_status()
    except httpx.HTTPError as exc:
        error = f"Failed to start run: {_describe_http_error(exc)}"
        return "", [], error

    run_id = safe_get(create_resp.json(), "run_id")
    if not run_id:
        return "", [], "API response did not include a run_id."

    response_parts: list[str] = []
    tool_events: list[Any] = []
    stream_error: str | None = None

    try:
        async with client.stream("GET", f"/v1/runs/{run_id}/stream") as stream_resp:
            stream_resp.raise_for_status()
            with Live(
                _stream_render("", tool_events),
                console=console,
                refresh_per_second=12,
                transient=True,
            ) as live:
                async for event_type, payload in _iter_sse_events(stream_resp):
                    if event_type == "token":
                        response_parts.append(str(payload.get("content", "")))
                    elif event_type == "tool_call":
                        tool_events.append(_tool_call_panel(payload))
                    elif event_type == "tool_result":
                        tool_events.append(_tool_result_text(payload))
                    elif event_type == "error":
                        stream_error = str(payload.get("message") or "The stream reported an error.")
                        live.update(_stream_render("".join(response_parts), tool_events))
                        break
                    elif event_type == "done":
                        done_content = payload.get("content")
                        if done_content and not response_parts:
                            response_parts.append(str(done_content))
                        live.update(_stream_render("".join(response_parts), tool_events))
                        break

                    live.update(_stream_render("".join(response_parts), tool_events))
    except httpx.HTTPError as exc:
        stream_error = f"Streaming failed: {_describe_http_error(exc)}"

    response_text = "".join(response_parts).strip()
    return response_text, tool_events, stream_error


async def _iter_sse_events(stream_resp: httpx.Response) -> AsyncIterator[tuple[str, dict[str, Any]]]:
    event_type = "message"
    data_lines: list[str] = []

    async for raw_line in stream_resp.aiter_lines():
        line = raw_line.strip("\r")
        if not line:
            if data_lines:
                yield event_type, _decode_event_payload("\n".join(data_lines))
            event_type = "message"
            data_lines = []
            continue
        if line.startswith(":"):
            continue
        if line.startswith("event:"):
            event_type = line[6:].strip()
            continue
        if line.startswith("data:"):
            data_lines.append(line[5:].strip())

    if data_lines:
        yield event_type, _decode_event_payload("\n".join(data_lines))


def _decode_event_payload(raw_payload: str) -> dict[str, Any]:
    try:
        data = json.loads(raw_payload)
        return data if isinstance(data, dict) else {"value": data}
    except json.JSONDecodeError:
        return {"message": raw_payload}


def _print_header(agent: dict[str, Any]) -> None:
    header = Group(
        Padding(
            Text.assemble(
                ("Conflux Chat", "bold white"),
                ("  ·  ", "muted"),
                (f"Agent: {safe_get(agent, 'name', default='Unknown Agent')}", "chat.agent"),
            ),
            (0, 1, 0, 1),
        ),
        Padding(
            Text("Type your message, 'quit' or Ctrl+C to exit", style="muted"),
            (0, 1, 0, 1),
        ),
    )
    console.print(Panel(header, border_style="panel.border", expand=False))
    console.print(Rule(style="panel.border"))


def _message_panel(message: dict[str, str]) -> Panel:
    role = message.get("role", "assistant")
    content = message.get("content", "")

    if role == "user":
        return Panel(
            Text(content),
            title="[bold cyan]You[/bold cyan]",
            border_style="cyan",
        )
    if role == "assistant":
        body = Markdown(content or "_No response received._")
        return Panel(
            body,
            title="[bold green]Agent[/bold green]",
            border_style="green",
        )
    return Panel(
        Text(content, style="chat.system"),
        title=f"[dim]{role.title()}[/dim]",
        border_style="panel.border",
    )


def _stream_render(response_text: str, tool_events: list[Any]) -> Group:
    preview = Text(response_text or "…", overflow="fold")
    renderables: list[Any] = [
        Panel(
            preview,
            title="[bold green]Agent[/bold green]",
            border_style="green",
        )
    ]
    renderables.extend(tool_events)
    return Group(*renderables)


def _tool_call_panel(payload: dict[str, Any]) -> Panel:
    name = str(payload.get("name") or "tool")
    args = truncate(_jsonish(payload.get("args", {})), 120)
    return Panel(
        Text(f"⚙ {name}({args})", style=TOOL_STYLE),
        border_style=TOOL_STYLE,
    )


def _tool_result_text(payload: dict[str, Any]) -> Text:
    result = truncate(_jsonish(payload.get("result", "")), 120)
    return Text(f"  → {result}", style="chat.tool_result")


def _jsonish(value: Any) -> str:
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, ensure_ascii=False, default=str)
    except TypeError:
        return str(value)


def _describe_http_error(exc: httpx.HTTPError) -> str:
    if isinstance(exc, httpx.HTTPStatusError):
        detail: Any
        try:
            detail = exc.response.json()
        except ValueError:
            detail = exc.response.text
        if isinstance(detail, dict):
            detail = safe_get(detail, "detail", default=detail)
        return f"{exc.response.status_code} {detail}"
    return str(exc)


__all__ = ["run_chat"]
