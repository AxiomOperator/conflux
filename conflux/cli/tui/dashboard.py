"""Full-screen Rich dashboard for the Conflux AI Agent Harness."""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import httpx
from rich.align import Align
from rich.columns import Columns
from rich.console import Console
from rich.layout import Layout
from rich.live import Live
from rich.padding import Padding
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

from conflux.cli.tui.theme import THEME
from conflux.cli.tui.utils import fmt_dt, make_client, safe_get, status_style, truncate

try:
    from conflux import __version__ as CONFLUX_VERSION
except ImportError:  # pragma: no cover - defensive fallback
    CONFLUX_VERSION = "0.29.0"

REFRESH_INTERVAL = 3
REQUEST_TIMEOUT = 10.0

# 401 sentinel — means auth is required, not a transient error
_AUTH_ERROR = "auth_required"


@dataclass(slots=True)
class DashboardState:
    """Live dashboard state."""

    stats: dict[str, Any] = field(default_factory=dict)
    runs: list[dict[str, Any]] = field(default_factory=list)
    agents: list[dict[str, Any]] = field(default_factory=list)
    errors: dict[str, str] = field(default_factory=dict)
    last_refreshed: datetime | None = None


async def _fetch_json(client: httpx.AsyncClient, path: str, **params: Any) -> Any:
    response = await client.get(path, params=params or None)
    response.raise_for_status()
    return response.json()


def _is_auth_error(exc: Exception) -> bool:
    return isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code == 401


async def _load_state(client: httpx.AsyncClient) -> DashboardState:
    # Fetch runs and agents; try admin/stats but gracefully fall back
    run_task = _fetch_json(client, "/v1/runs", limit=20)
    agent_task = _fetch_json(client, "/v1/agents")
    admin_task = _fetch_json(client, "/v1/admin/stats")

    runs_r, agents_r, stats_r = await asyncio.gather(
        run_task, agent_task, admin_task, return_exceptions=True
    )

    state = DashboardState(last_refreshed=datetime.now())

    # Check for auth errors first — if runs/agents are 401 there's no point retrying
    if _is_auth_error(runs_r) or _is_auth_error(agents_r):
        state.errors[_AUTH_ERROR] = (
            "Authentication required.\n"
            "Set CONFLUX_API_KEY env var or pass --api-key <key>.\n"
            "Generate a key in the Conflux UI → Settings → API Keys."
        )
        return state

    if isinstance(runs_r, list):
        state.runs = runs_r
    elif isinstance(runs_r, Exception):
        state.errors["runs"] = _format_error(runs_r)

    if isinstance(agents_r, list):
        state.agents = agents_r
    elif isinstance(agents_r, Exception):
        state.errors["agents"] = _format_error(agents_r)

    # Admin stats — silently fall back to computed stats for non-admins
    if isinstance(stats_r, dict):
        state.stats = stats_r
    else:
        # Compute basic stats from what we already have
        running = sum(1 for r in state.runs if r.get("status") == "running")
        state.stats = {
            "total_runs": len(state.runs),
            "active_runs": running,
            "total_agents": len(state.agents),
            "total_memories": None,  # not available without admin
        }
        if isinstance(stats_r, Exception) and not _is_auth_error(stats_r):
            state.errors["stats"] = _format_error(stats_r)

    return state


def _format_error(error: Exception) -> str:
    if isinstance(error, httpx.HTTPStatusError):
        status = error.response.status_code
        detail = error.response.text.strip()
        return f"HTTP {status}: {detail or error.response.reason_phrase}"
    if isinstance(error, httpx.HTTPError):
        return str(error) or error.__class__.__name__
    return f"{error.__class__.__name__}: {error}"


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _format_duration(run: dict[str, Any]) -> str:
    started = _parse_iso(run.get("started_at") or run.get("created_at"))
    finished = _parse_iso(run.get("completed_at"))
    status = str(run.get("status") or "").lower()

    if not started:
        return "—"
    if not finished:
        if status in {"queued", "running", "active"}:
            finished = datetime.now(timezone.utc)
        else:
            return "—"

    total_seconds = max(0, int((finished - started).total_seconds()))
    if total_seconds < 60:
        return f"{total_seconds}s"
    minutes, seconds = divmod(total_seconds, 60)
    if minutes < 60:
        return f"{minutes}m {seconds:02d}s"
    hours, minutes = divmod(minutes, 60)
    if hours < 24:
        return f"{hours}h {minutes:02d}m"
    days, hours = divmod(hours, 24)
    return f"{days}d {hours}h"


def _message_content(message: Any) -> str:
    if isinstance(message, str):
        return message
    if isinstance(message, list):
        parts: list[str] = []
        for item in message:
            if isinstance(item, dict):
                text = item.get("text") or safe_get(item, "content", "text")
                if isinstance(text, str):
                    parts.append(text)
            elif isinstance(item, str):
                parts.append(item)
        return " ".join(parts)
    if isinstance(message, dict):
        text = message.get("text") or safe_get(message, "content", "text")
        if isinstance(text, str):
            return text
    return ""


def _first_user_message(run: dict[str, Any]) -> str:
    for key in ("first_user_message", "message", "prompt"):
        value = run.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()

    messages = (
        safe_get(run, "input", "messages", default=None)
        or run.get("messages")
        or run.get("input_messages")
        or []
    )
    if not isinstance(messages, list):
        return ""

    for entry in messages:
        if not isinstance(entry, dict):
            continue
        if entry.get("role") != "user":
            continue
        content = _message_content(entry.get("content"))
        if content.strip():
            return content.strip()
    return ""


def _stat_panel(label: str, value: Any, accent: str = "highlight") -> Panel:
    display = "—" if value is None else str(value)
    text = Text(justify="center")
    text.append(display + "\n", accent)
    text.append(label, "muted")
    return Panel(
        Align.center(text, vertical="middle"),
        border_style="panel.border",
        padding=(1, 2),
    )


def _build_header(api_url: str, last_refreshed: datetime | None) -> Panel:
    header = Table.grid(expand=True)
    header.add_column(justify="left")
    header.add_column(justify="center")
    header.add_column(justify="right")

    refreshed = last_refreshed.strftime("%H:%M:%S") if last_refreshed else "—"
    header.add_row(
        Text(f"Conflux v{CONFLUX_VERSION}", style="header.version"),
        Text(api_url, style="header.url", overflow="ellipsis", no_wrap=True),
        Text(f"last refreshed: {refreshed}", style="muted"),
    )
    return Panel(header, border_style="panel.border", padding=(0, 1))


def _build_stats(stats: dict[str, Any], agents: list[dict[str, Any]]) -> Columns:
    total_runs = stats.get("total_runs")
    active_runs = stats.get("active_runs", stats.get("running_runs"))
    total_agents = stats.get("total_agents", len(agents) if agents else None)
    total_memories = stats.get("total_memories")

    return Columns(
        [
            _stat_panel("Runs", total_runs),
            _stat_panel("Active", active_runs, accent="warn"),
            _stat_panel("Agents", total_agents, accent="success"),
            _stat_panel("Memories", total_memories, accent="highlight"),
        ],
        expand=True,
    )


def _build_runs_table(runs: list[dict[str, Any]], agents: list[dict[str, Any]]) -> Panel:
    table = Table(expand=True, border_style="panel.border")
    table.add_column("ID", style="dim.id", no_wrap=True, width=8)
    table.add_column("Status", no_wrap=True, width=10)
    table.add_column("Agent", no_wrap=True, width=16)
    table.add_column("Started", no_wrap=True, width=12)
    table.add_column("Duration", no_wrap=True, width=10)
    table.add_column("Message", ratio=1)

    agent_names = {
        str(agent.get("id")): str(agent.get("name") or agent.get("slug") or agent.get("id") or "")
        for agent in agents
    }

    if not runs:
        table.add_row("—", "—", "—", "—", "—", "No runs available")
    else:
        for run in runs[:20]:
            run_id = str(run.get("id") or "—")[:8]
            status = str(run.get("status") or "unknown")
            agent_id = str(run.get("agent_id") or "")
            agent_name = agent_names.get(agent_id) or truncate(agent_id, 16) or "—"
            started = fmt_dt(run.get("started_at") or run.get("created_at"))
            duration = _format_duration(run)
            message = truncate(_first_user_message(run) or "", 72) or "—"
            table.add_row(
                run_id,
                Text.from_markup(status_style(status)),
                truncate(agent_name, 16),
                started,
                duration,
                message,
            )

    return Panel(table, title="Recent Runs", border_style="panel.border")


def _build_error_panel(errors: dict[str, str]) -> Panel:
    # Auth error gets special treatment — clear instructions, no retry noise
    if _AUTH_ERROR in errors:
        body = Table.grid(padding=(0, 1))
        body.add_column(style="warn", no_wrap=True)
        body.add_column()
        body.add_row("[bold red]✗  Authentication Required[/bold red]", "")
        body.add_row("", "")
        for line in errors[_AUTH_ERROR].split("\n"):
            body.add_row("", line)
        body.add_row("", "")
        body.add_row("[dim]hint[/dim]", "[dim]export CONFLUX_API_KEY=<your-key>  then re-run[/dim]")
        body.add_row("[dim]hint[/dim]", "[dim]or: conflux dashboard --api-key <your-key>[/dim]")
        return Panel(body, title="[bold red]Access Denied[/bold red]", border_style="red")

    body = Table.grid(padding=(0, 1))
    body.add_column(style="label", no_wrap=True)
    body.add_column(style="error")
    for source, message in errors.items():
        body.add_row(source, truncate(message, 120) or "Unknown error")
    body.add_row("retry", "Retrying automatically every 3 seconds. Press Ctrl+C to quit.")
    return Panel(body, title="API Unreachable", border_style="error")


def _build_footer(errors: dict[str, str]) -> Panel:
    if _AUTH_ERROR in errors:
        text = Text("Authentication required — press Ctrl+C to quit, then set CONFLUX_API_KEY", style="error")
    elif errors:
        message = " • ".join(f"{name}: {truncate(text, 40)}" for name, text in errors.items())
        text = Text(f"Partial data available • {message}", style="warn")
    else:
        text = Text("Auto-refresh every 3s • Press Ctrl+C to quit", style="muted")
    return Panel(Padding(text, (0, 1)), border_style="panel.border")


def _build_dashboard(api_url: str, state: DashboardState) -> Layout:
    layout = Layout()
    layout.split_column(
        Layout(name="header", size=3),
        Layout(name="stats", size=7),
        Layout(name="runs", ratio=1),
        Layout(name="footer", size=3),
    )

    layout["header"].update(_build_header(api_url, state.last_refreshed))
    layout["stats"].update(_build_stats(state.stats, state.agents))

    if state.errors and not (state.stats or state.runs or state.agents):
        layout["runs"].update(_build_error_panel(state.errors))
    else:
        layout["runs"].update(_build_runs_table(state.runs, state.agents))

    layout["footer"].update(_build_footer(state.errors))
    return layout


async def run_dashboard(api_url: str, api_key: str) -> None:
    """Run the full-screen Rich Live dashboard until interrupted."""
    console = Console(theme=THEME)
    state = DashboardState(last_refreshed=datetime.now())

    async with make_client(api_url, api_key, timeout=REQUEST_TIMEOUT) as client:
        with Live(
            _build_dashboard(api_url, state),
            console=console,
            screen=True,
            refresh_per_second=4,
        ) as live:
            while True:
                state = await _load_state(client)
                live.update(_build_dashboard(api_url, state))
                # Stop polling on auth errors — user must fix credentials
                if _AUTH_ERROR in state.errors:
                    await asyncio.sleep(3600)  # block until Ctrl+C
                    continue
                await asyncio.sleep(REFRESH_INTERVAL)


__all__ = ["run_dashboard"]
