"""Rich Live monitors for Conflux agent runs."""
from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Any

import httpx
from rich import box
from rich.console import Console, Group, RenderableType
from rich.live import Live
from rich.markdown import Markdown
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.table import Table
from rich.text import Text

from conflux.cli.tui.theme import THEME
from conflux.cli.tui.utils import fmt_dt, make_client, safe_get, status_style, truncate

console = Console(theme=THEME)


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _format_duration(started_at: str | None, completed_at: str | None = None) -> str:
    start = _parse_dt(started_at)
    if not start:
        return "—"
    end = _parse_dt(completed_at) or datetime.now(timezone.utc)
    delta = max(int((end - start).total_seconds()), 0)
    hours, remainder = divmod(delta, 3600)
    minutes, seconds = divmod(remainder, 60)
    if hours:
        return f"{hours}h {minutes:02}m {seconds:02}s"
    if minutes:
        return f"{minutes}m {seconds:02}s"
    return f"{seconds}s"


def _preview(value: Any, width: int = 72) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return truncate(value, width)
    try:
        rendered = json.dumps(value, ensure_ascii=False, sort_keys=True)
    except TypeError:
        rendered = str(value)
    return truncate(rendered, width)


def _extract_output_text(output: Any) -> str:
    if output is None:
        return ""
    if isinstance(output, str):
        return output
    if isinstance(output, dict):
        for key in ("content", "text", "result", "message", "error"):
            value = safe_get(output, key)
            if isinstance(value, str) and value.strip():
                return value
        return json.dumps(output, indent=2, ensure_ascii=False, sort_keys=True)
    return str(output)


def _total_tokens(run_data: dict[str, Any]) -> int | None:
    total = safe_get(run_data, "token_usage", "total_tokens")
    return total if isinstance(total, int) else None


def _agent_name(agent_lookup: dict[str, str], agent_id: str | None) -> str:
    if not agent_id:
        return "Unknown"
    return agent_lookup.get(agent_id, f"{agent_id[:8]}…")


async def _agent_lookup(client: httpx.AsyncClient) -> dict[str, str]:
    response = await client.get("/v1/agents")
    response.raise_for_status()
    return {
        str(agent.get("id", "")): agent.get("name") or f"{str(agent.get('id', ''))[:8]}…"
        for agent in response.json()
    }


async def _iter_sse(response: httpx.Response) -> AsyncIterator[tuple[str, dict[str, Any]]]:
    event_type = "message"
    data_lines: list[str] = []

    async for line in response.aiter_lines():
        if not line:
            if data_lines or event_type:
                payload: dict[str, Any] = {}
                raw_data = "\n".join(data_lines).strip()
                if raw_data:
                    try:
                        payload = json.loads(raw_data)
                    except json.JSONDecodeError:
                        payload = {"raw": raw_data}
                yield event_type, payload
            event_type = "message"
            data_lines = []
            continue
        if line.startswith("event:"):
            event_type = line[6:].strip() or "message"
        elif line.startswith("data:"):
            data_lines.append(line[5:].strip())

    if data_lines:
        raw_data = "\n".join(data_lines).strip()
        payload: dict[str, Any] = {}
        if raw_data:
            try:
                payload = json.loads(raw_data)
            except json.JSONDecodeError:
                payload = {"raw": raw_data}
        yield event_type, payload


def _spinner() -> Progress:
    progress = Progress(
        SpinnerColumn(style="cyan"),
        TextColumn("[bold cyan]{task.description}"),
        transient=False,
    )
    progress.add_task("Waiting for first token…", total=None)
    return progress


def _stats_text(run_data: dict[str, Any]) -> Text:
    text = Text()
    status = str(run_data.get("status") or "unknown")
    tokens = _total_tokens(run_data)
    duration = _format_duration(run_data.get("started_at"), run_data.get("completed_at"))
    text.append("Status: ", style="label")
    text.append_text(Text.from_markup(status_style(status)))
    text.append("  •  Duration: ", style="label")
    text.append(duration, style="highlight")
    text.append("  •  Tokens: ", style="label")
    text.append(str(tokens) if tokens is not None else "—", style="highlight")
    return text


def _monitor_title(run_id: str, agent_name: str) -> Text:
    title = Text()
    title.append(f"Monitoring Run {run_id[:8]}...", style="bold cyan")
    title.append(" | Agent: ", style="muted")
    title.append(agent_name, style="highlight")
    return title


def _monitor_panel(
    run_id: str,
    agent_name: str,
    transcript: Text,
    events: list[RenderableType],
    waiting: bool,
    final_stats: Text | None = None,
) -> Panel:
    body: list[RenderableType] = []
    if waiting:
        body.append(_spinner())
    else:
        body.append(transcript if transcript.plain else Text("No streamed output yet.", style="muted"))
    body.extend(events)
    if final_stats is not None:
        body.append(Text())
        body.append(final_stats)
    return Panel(
        Group(*body),
        title=_monitor_title(run_id, agent_name),
        border_style="cyan",
        padding=(1, 2),
    )


def _monitor_error(run_id: str, message: str) -> Panel:
    return Panel(
        Text(message, style="error"),
        title=f"Monitoring Run {run_id[:8]}...",
        border_style="red",
        padding=(1, 2),
    )


async def _fetch_run_snapshot(
    client: httpx.AsyncClient,
    run_id: str,
) -> tuple[dict[str, Any], dict[str, str]]:
    run_response, agents = await asyncio.gather(
        client.get(f"/v1/runs/{run_id}"),
        _agent_lookup(client),
    )
    run_response.raise_for_status()
    return run_response.json(), agents


def _tool_panel(name: str, args_preview: str) -> Panel:
    tool_line = Text()
    tool_line.append("⚙ ", style="yellow")
    tool_line.append(name, style="chat.tool")
    tool_line.append(f"({args_preview})", style="muted")
    return Panel(tool_line, border_style="yellow", padding=(0, 1))


async def monitor_run(run_id: str, api_url: str, api_key: str) -> None:
    async with make_client(api_url, api_key, timeout=300.0) as client:
        try:
            run_data, agents = await _fetch_run_snapshot(client, run_id)
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 401:
                console.print(
                    "[error]Authentication required.[/error]\n"
                    "[muted]Set [bold]CONFLUX_API_KEY[/bold] or use [bold]--api-key[/bold].[/muted]"
                )
                return
            raise
        agent_name = _agent_name(agents, run_data.get("agent_id"))

        if run_data.get("status") not in {"queued", "running"}:
            output_text = _extract_output_text(run_data.get("output")) or "_No output available._"
            console.print(
                Panel(
                    Markdown(output_text),
                    title=_monitor_title(run_id, agent_name),
                    border_style="cyan",
                    padding=(1, 2),
                    subtitle=_stats_text(run_data),
                )
            )
            return

        transcript = Text()
        events: list[RenderableType] = []
        waiting_for_token = True
        final_stats: Text | None = None

        with Live(
            _monitor_panel(run_id, agent_name, transcript, events, waiting_for_token),
            console=console,
            refresh_per_second=8,
        ) as live:
            try:
                async with client.stream("GET", f"/v1/runs/{run_id}/stream") as response:
                    response.raise_for_status()
                    async for event_type, payload in _iter_sse(response):
                        if event_type == "token":
                            content = payload.get("content", "")
                            if content:
                                transcript.append(str(content))
                                waiting_for_token = False
                        elif event_type == "tool_call":
                            tool_name = str(payload.get("name") or "tool")
                            args_preview = _preview(payload.get("args"), width=64)
                            events.append(_tool_panel(tool_name, args_preview))
                        elif event_type == "tool_result":
                            result_preview = _preview(payload.get("result"), width=88)
                            events.append(Text(f"  → {result_preview}", style="chat.tool_result"))
                        elif event_type == "error":
                            message = str(payload.get("message") or payload.get("raw") or "Unknown error")
                            events.append(Text(f"Error: {message}", style="error"))
                        elif event_type == "done":
                            break

                        live.update(
                            _monitor_panel(
                                run_id,
                                agent_name,
                                transcript,
                                events,
                                waiting_for_token,
                                final_stats,
                            )
                        )

                run_data, _ = await _fetch_run_snapshot(client, run_id)
                final_stats = _stats_text(run_data)
                if waiting_for_token and not transcript.plain:
                    output_text = _extract_output_text(run_data.get("output"))
                    if output_text:
                        transcript.append(output_text)
                        waiting_for_token = False
                live.update(
                    _monitor_panel(
                        run_id,
                        agent_name,
                        transcript,
                        events,
                        waiting_for_token,
                        final_stats,
                    )
                )
            except httpx.HTTPError as exc:
                live.update(_monitor_error(run_id, f"Stream failed: {exc}"))


async def _run_detail(client: httpx.AsyncClient, run_id: str) -> dict[str, Any]:
    response = await client.get(f"/v1/runs/{run_id}")
    response.raise_for_status()
    return response.json()


async def _fetch_recent_runs(client: httpx.AsyncClient) -> list[dict[str, Any]]:
    runs_response, agents = await asyncio.gather(
        client.get("/v1/runs?limit=50"),
        _agent_lookup(client),
    )
    runs_response.raise_for_status()
    summaries = runs_response.json()[:30]
    detail_results = await asyncio.gather(
        *(_run_detail(client, str(run.get("id"))) for run in summaries),
        return_exceptions=True,
    )

    rows: list[dict[str, Any]] = []
    for summary, detail_result in zip(summaries, detail_results, strict=False):
        detail = summary.copy()
        if isinstance(detail_result, dict):
            detail.update(detail_result)

        agent_id = detail.get("agent_id") or summary.get("agent_id")
        rows.append(
            {
                "id": str(detail.get("id") or summary.get("id") or ""),
                "status": str(detail.get("status") or summary.get("status") or "unknown"),
                "agent": _agent_name(agents, str(agent_id) if agent_id else None),
                "started": detail.get("started_at") or summary.get("created_at"),
                "completed": detail.get("completed_at"),
                "tokens": _total_tokens(detail),
            }
        )
    return rows


def _runs_table(
    rows: list[dict[str, Any]],
    *,
    warning: str | None = None,
    updated_at: datetime | None = None,
) -> Group:
    table = Table(box=box.ROUNDED, title="Recent Runs", expand=True)
    table.add_column("ID", style="dim.id", no_wrap=True)
    table.add_column("Status", no_wrap=True)
    table.add_column("Agent")
    table.add_column("Started", no_wrap=True)
    table.add_column("Duration", no_wrap=True)
    table.add_column("Tokens", justify="right", no_wrap=True)

    for row in rows:
        row_style = "on #4a3f00" if row["status"] == "running" else ""
        table.add_row(
            f"{row['id'][:8]}",
            status_style(row["status"]),
            truncate(row["agent"], 28),
            fmt_dt(row.get("started")),
            _format_duration(row.get("started"), row.get("completed")),
            str(row["tokens"]) if row.get("tokens") is not None else "—",
            style=row_style,
        )

    footer = Text()
    footer.append("Press Ctrl+C to stop monitoring", style="muted")
    footer.append(" | ", style="muted")
    footer.append(
        f"Last updated: {(updated_at or datetime.now()).strftime('%H:%M:%S')}",
        style="highlight",
    )

    renderables: list[RenderableType] = [table]
    if warning:
        renderables.append(Text(f"Warning: {warning}", style="warn"))
    renderables.append(footer)
    return Group(*renderables)


async def monitor_all(api_url: str, api_key: str) -> None:
    last_rows: list[dict[str, Any]] = []
    warning: str | None = None
    updated_at: datetime | None = None

    async with make_client(api_url, api_key, timeout=30.0) as client:
        with Live(
            _runs_table(last_rows, warning=warning, updated_at=updated_at),
            console=console,
            refresh_per_second=2,
        ) as live:
            try:
                while True:
                    try:
                        last_rows = await _fetch_recent_runs(client)
                        warning = None
                    except httpx.HTTPStatusError as exc:
                        if exc.response.status_code == 401:
                            console.print(
                                "[error]Authentication required.[/error]\n"
                                "[muted]Set [bold]CONFLUX_API_KEY[/bold] or use [bold]--api-key[/bold].[/muted]"
                            )
                            return
                        warning = f"API error ({exc.response.status_code}) — showing last known data."
                    except httpx.HTTPError as exc:
                        warning = f"API unavailable ({exc}) — showing last known data."
                    updated_at = datetime.now()
                    live.update(_runs_table(last_rows, warning=warning, updated_at=updated_at))
                    await asyncio.sleep(2)
            except KeyboardInterrupt:
                return
