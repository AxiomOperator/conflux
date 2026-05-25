"""agent commands."""
import asyncio
import json

import httpx
import typer
from rich.console import Console
from rich.table import Table

app = typer.Typer(no_args_is_help=True)
console = Console()


def _h(k: str) -> dict:
    return {"X-API-Key": k} if k else {}


@app.command("list")
def list_agents(
    api_url: str = typer.Option("http://localhost:3000", envvar="CONFLUX_API_URL"),
    api_key: str = typer.Option("", envvar="CONFLUX_API_KEY"),
):
    """List all agents."""

    async def _inner():
        async with httpx.AsyncClient(
            base_url=api_url,
            headers=_h(api_key),
            timeout=30,
        ) as c:
            r = await c.get("/v1/agents")
            r.raise_for_status()
        t = Table(title="Agents")
        t.add_column("ID", style="dim")
        t.add_column("Name")
        t.add_column("Type")
        t.add_column("Description")
        for a in r.json():
            t.add_row(
                a["id"][:8] + "...",
                a["name"],
                a["type"],
                (a.get("description") or "")[:60],
            )
        console.print(t)

    asyncio.run(_inner())


@app.command("get")
def get_agent(
    agent_id: str = typer.Argument(),
    api_url: str = typer.Option("http://localhost:3000", envvar="CONFLUX_API_URL"),
    api_key: str = typer.Option("", envvar="CONFLUX_API_KEY"),
):
    """Show agent details."""

    async def _inner():
        async with httpx.AsyncClient(
            base_url=api_url,
            headers=_h(api_key),
            timeout=30,
        ) as c:
            r = await c.get(f"/v1/agents/{agent_id}")
            r.raise_for_status()
        console.print_json(json.dumps(r.json()))

    asyncio.run(_inner())
