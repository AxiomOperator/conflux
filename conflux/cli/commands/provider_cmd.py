"""provider commands."""
import asyncio

import httpx
import typer
from rich.console import Console
from rich.table import Table

app = typer.Typer(no_args_is_help=True)
console = Console()


def _h(k: str) -> dict:
    return {"X-API-Key": k} if k else {}


@app.command("list")
def list_providers(
    api_url: str = typer.Option("http://localhost:3000", envvar="CONFLUX_API_URL"),
    api_key: str = typer.Option("", envvar="CONFLUX_API_KEY"),
):
    """List LLM providers."""

    async def _inner():
        async with httpx.AsyncClient(
            base_url=api_url,
            headers=_h(api_key),
            timeout=30,
        ) as c:
            r = await c.get("/v1/providers")
            r.raise_for_status()
        t = Table(title="Providers")
        t.add_column("Name")
        t.add_column("Type")
        t.add_column("URL")
        t.add_column("Health")
        for p in r.json():
            h = p.get("health", "unknown")
            style = {"healthy": "green", "unhealthy": "red"}.get(h, "yellow")
            t.add_row(p["name"], p["type"], p["base_url"], f"[{style}]{h}[/{style}]")
        console.print(t)

    asyncio.run(_inner())


@app.command("health")
def health_all(
    api_url: str = typer.Option("http://localhost:3000", envvar="CONFLUX_API_URL"),
    api_key: str = typer.Option("", envvar="CONFLUX_API_KEY"),
):
    """Run health checks on all providers."""

    async def _inner():
        async with httpx.AsyncClient(
            base_url=api_url,
            headers=_h(api_key),
            timeout=30,
        ) as c:
            r = await c.get("/v1/providers")
            r.raise_for_status()
            providers = r.json()
        for p in providers:
            async with httpx.AsyncClient(
                base_url=api_url,
                headers=_h(api_key),
                timeout=30,
            ) as c:
                hr = await c.post(f"/v1/providers/{p['id']}/health-check")
            ok = hr.json().get("healthy", False) if hr.status_code == 200 else False
            status = "[green]✓ healthy[/green]" if ok else "[red]✗ unhealthy[/red]"
            console.print(f"  {p['name']}: {status}")

    asyncio.run(_inner())


@app.command("models")
def list_models(
    provider_id: str = typer.Argument(),
    api_url: str = typer.Option("http://localhost:3000", envvar="CONFLUX_API_URL"),
    api_key: str = typer.Option("", envvar="CONFLUX_API_KEY"),
):
    """List models for a provider."""

    async def _inner():
        async with httpx.AsyncClient(
            base_url=api_url,
            headers=_h(api_key),
            timeout=30,
        ) as c:
            r = await c.get(f"/v1/providers/{provider_id}/models")
            r.raise_for_status()
        for m in r.json().get("models", []):
            console.print(f"  [cyan]{m}[/cyan]")

    asyncio.run(_inner())
