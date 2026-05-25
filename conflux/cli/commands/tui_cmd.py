"""TUI commands — full-screen Rich terminal interface."""
import asyncio

import typer
from rich.console import Console

app = typer.Typer(no_args_is_help=True, help="Rich TUI views")
console = Console()


@app.command("dashboard")
def dashboard(
    api_url: str = typer.Option("http://localhost:3000", envvar="CONFLUX_API_URL"),
    api_key: str = typer.Option("", envvar="CONFLUX_API_KEY"),
):
    """Launch the full-screen live dashboard."""
    from conflux.cli.tui.dashboard import run_dashboard

    asyncio.run(run_dashboard(api_url, api_key))


@app.command("chat")
def chat(
    agent_id: str = typer.Argument(help="Agent ID or name prefix"),
    message: str | None = typer.Option(
        None,
        "--message",
        "-m",
        help="One-shot message (non-interactive)",
    ),
    api_url: str = typer.Option("http://localhost:3000", envvar="CONFLUX_API_URL"),
    api_key: str = typer.Option("", envvar="CONFLUX_API_KEY"),
):
    """Interactive Rich chat with an agent. Use --message for one-shot."""
    from conflux.cli.tui.chat import run_chat

    asyncio.run(run_chat(agent_id, api_url, api_key, initial_message=message))


@app.command("monitor")
def monitor(
    run_id: str | None = typer.Argument(
        default=None,
        help="Run ID to monitor (omit for all active runs)",
    ),
    api_url: str = typer.Option("http://localhost:3000", envvar="CONFLUX_API_URL"),
    api_key: str = typer.Option("", envvar="CONFLUX_API_KEY"),
):
    """Monitor a specific run or watch all active runs live."""
    from conflux.cli.tui.monitor import monitor_all, monitor_run

    if run_id:
        asyncio.run(monitor_run(run_id, api_url, api_key))
    else:
        asyncio.run(monitor_all(api_url, api_key))
