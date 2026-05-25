"""Shared TUI utilities: API client factory and formatting helpers."""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

import httpx

from conflux.cli.tui.theme import STATUS_COLOUR


# ── API client ────────────────────────────────────────────────────────────────

def make_client(
    api_url: str | None = None,
    api_key: str | None = None,
    timeout: float = 30.0,
) -> httpx.AsyncClient:
    """Return a configured AsyncClient that reads env vars as fallback."""
    url = api_url or os.environ.get("CONFLUX_API_URL", "http://localhost:3000")
    key = api_key or os.environ.get("CONFLUX_API_KEY", "")
    headers: dict[str, str] = {}
    if key:
        headers["X-API-Key"] = key
    return httpx.AsyncClient(base_url=url, headers=headers, timeout=timeout)


# ── Formatting ────────────────────────────────────────────────────────────────

def status_style(status: str) -> str:
    """Return a Rich markup string for *status* with the correct colour."""
    colour = STATUS_COLOUR.get(status, "white")
    return f"[{colour}]{status}[/{colour}]"


def fmt_dt(iso: str | None, *, relative: bool = True) -> str:
    """Format an ISO-8601 timestamp for display."""
    if not iso:
        return "—"
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return iso[:19]
    if not relative:
        return dt.strftime("%Y-%m-%d %H:%M")
    now = datetime.now(timezone.utc)
    diff = now - dt.replace(tzinfo=dt.tzinfo or timezone.utc)
    secs = int(diff.total_seconds())
    if secs < 60:
        return f"{secs}s ago"
    if secs < 3600:
        return f"{secs // 60}m ago"
    if secs < 86400:
        return f"{secs // 3600}h ago"
    return f"{secs // 86400}d ago"


def truncate(text: str | None, width: int = 60) -> str:
    """Truncate *text* to *width* characters with an ellipsis."""
    if not text:
        return ""
    text = text.replace("\n", " ")
    return text if len(text) <= width else text[: width - 1] + "…"


def safe_get(data: dict[str, Any], *keys: str, default: Any = None) -> Any:
    """Safely traverse nested dict keys."""
    cur: Any = data
    for k in keys:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(k, default)
    return cur
