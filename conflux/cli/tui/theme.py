"""Conflux TUI colour theme and shared style constants."""
from rich.style import Style
from rich.theme import Theme

THEME = Theme(
    {
        # status badges
        "status.running": "bold yellow",
        "status.completed": "bold green",
        "status.failed": "bold red",
        "status.queued": "dim white",
        "status.cancelled": "dim red",
        # structural chrome
        "header": "bold white on #1a1a2e",
        "header.version": "cyan",
        "header.url": "dim white",
        "panel.title": "bold cyan",
        "panel.border": "bright_black",
        # data
        "dim.id": "dim",
        "label": "bold",
        "muted": "dim white",
        "highlight": "bold cyan",
        "warn": "yellow",
        "error": "bold red",
        "success": "bold green",
        # chat
        "chat.user": "bold cyan",
        "chat.agent": "bold green",
        "chat.tool": "yellow",
        "chat.tool_result": "dim",
        "chat.system": "dim italic",
    }
)

# Colour map for run statuses (used in Rich markup)
STATUS_COLOUR: dict[str, str] = {
    "running": "yellow",
    "completed": "green",
    "failed": "red",
    "queued": "white",
    "cancelled": "red",
}

CONFLUX_BANNER = (
    "[bold cyan]╔═╗╔═╗╔╗╔╔═╗╦  ╦ ╦═╗ ╦[/bold cyan]\n"
    "[bold cyan]║  ║ ║║║║╠╣ ║  ║ ╔╩╦╝[/bold cyan]\n"
    "[bold cyan]╚═╝╚═╝╝╚╝╚  ╩═╝╚═╝╩ ╚═[/bold cyan]"
)
