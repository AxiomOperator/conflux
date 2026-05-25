"""Conflux CLI — Rich terminal interface for human testing and administration."""
import typer
from rich.console import Console

app = typer.Typer(
    name="conflux",
    help="Conflux AI Agent Harness — CLI",
    rich_markup_mode="rich",
    no_args_is_help=True,
)
console = Console()

from conflux.cli.commands import (
    admin_cmd,
    agent_cmd,
    memory_cmd,
    provider_cmd,
    run_cmd,
    skill_cmd,
    tui_cmd,
)

app.add_typer(run_cmd.app, name="run", help="Execute agent runs")
app.add_typer(agent_cmd.app, name="agent", help="Manage agents")
app.add_typer(memory_cmd.app, name="memory", help="Manage memory")
app.add_typer(skill_cmd.app, name="skill", help="Manage skills")
app.add_typer(provider_cmd.app, name="provider", help="Manage LLM providers")
app.add_typer(admin_cmd.app, name="admin", help="Administrative commands")
app.add_typer(tui_cmd.app, name="tui", help="Rich TUI views (dashboard, chat, monitor)")


@app.command("dashboard")
def dashboard_shortcut(
    api_url: str = typer.Option("http://localhost:3000", envvar="CONFLUX_API_URL"),
    api_key: str = typer.Option("", envvar="CONFLUX_API_KEY"),
):
    """Launch the full-screen live dashboard (shortcut for 'tui dashboard')."""
    import asyncio

    from conflux.cli.tui.dashboard import run_dashboard

    asyncio.run(run_dashboard(api_url, api_key))


@app.callback()
def main(
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Verbose output"),
    api_url: str = typer.Option(
        "http://localhost:3000",
        "--api-url",
        envvar="CONFLUX_API_URL",
    ),
):
    """Conflux CLI — interact with your AI agent harness."""
    pass


if __name__ == "__main__":
    app()
