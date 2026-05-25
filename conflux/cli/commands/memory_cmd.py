"""memory commands."""
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
def list_memory(
    scope: str = typer.Option("user"),
    limit: int = typer.Option(20, "-n"),
    api_url: str = typer.Option("http://localhost:3000", envvar="CONFLUX_API_URL"),
    api_key: str = typer.Option("", envvar="CONFLUX_API_KEY"),
):
    """List memory entries."""

    async def _inner():
        async with httpx.AsyncClient(
            base_url=api_url,
            headers=_h(api_key),
            timeout=30,
        ) as c:
            r = await c.get(f"/v1/memory?scope={scope}&limit={limit}")
            r.raise_for_status()
        data = r.json()
        t = Table(title=f"Memory ({scope})")
        t.add_column("Key", style="cyan")
        t.add_column("Value")
        t.add_column("Tags")
        for m in data.get("memories", []):
            t.add_row(
                m.get("key", ""),
                m.get("value", "")[:80],
                str(m.get("tags", [])),
            )
        console.print(t)

    asyncio.run(_inner())


@app.command("search")
def search_memory(
    query: str = typer.Argument(),
    scope: str = typer.Option("user"),
    api_url: str = typer.Option("http://localhost:3000", envvar="CONFLUX_API_URL"),
    api_key: str = typer.Option("", envvar="CONFLUX_API_KEY"),
):
    """Semantic search over memory."""

    async def _inner():
        async with httpx.AsyncClient(
            base_url=api_url,
            headers=_h(api_key),
            timeout=30,
        ) as c:
            r = await c.get(f"/v1/memory?scope={scope}&query={query}")
            r.raise_for_status()
        console.print_json(json.dumps(r.json()))

    asyncio.run(_inner())


@app.command("write")
def write_memory(
    key: str = typer.Argument(),
    value: str = typer.Argument(),
    scope: str = typer.Option("user"),
    api_url: str = typer.Option("http://localhost:3000", envvar="CONFLUX_API_URL"),
    api_key: str = typer.Option("", envvar="CONFLUX_API_KEY"),
):
    """Write a memory entry."""

    async def _inner():
        async with httpx.AsyncClient(
            base_url=api_url,
            headers=_h(api_key),
            timeout=30,
        ) as c:
            r = await c.post(
                "/v1/memory",
                json={"key": key, "value": value, "scope": scope},
            )
            r.raise_for_status()
        console.print(f"[green]✓[/green] Memory written: {key}")

    asyncio.run(_inner())
