"""admin commands."""
import asyncio

import httpx
import typer
from rich.console import Console
from rich.table import Table

app = typer.Typer(no_args_is_help=True)
console = Console()


def _h(k: str) -> dict:
    return {"X-API-Key": k} if k else {}


@app.command("stats")
def stats(
    api_url: str = typer.Option("http://localhost:3000", envvar="CONFLUX_API_URL"),
    api_key: str = typer.Option("", envvar="CONFLUX_API_KEY"),
):
    """Show system stats."""

    async def _inner():
        async with httpx.AsyncClient(
            base_url=api_url,
            headers=_h(api_key),
            timeout=30,
        ) as c:
            r = await c.get("/v1/admin/stats")
            r.raise_for_status()
        t = Table(title="Conflux Stats")
        t.add_column("Metric", style="cyan")
        t.add_column("Value")
        for k, v in r.json().items():
            t.add_row(k.replace("_", " ").title(), str(v))
        console.print(t)

    asyncio.run(_inner())


@app.command("evolution-list")
def evolution_list(
    api_url: str = typer.Option("http://localhost:3000", envvar="CONFLUX_API_URL"),
    api_key: str = typer.Option("", envvar="CONFLUX_API_KEY"),
):
    """List pending evolution candidates."""

    async def _inner():
        async with httpx.AsyncClient(
            base_url=api_url,
            headers=_h(api_key),
            timeout=30,
        ) as c:
            r = await c.get("/v1/admin/evolution-candidates")
            r.raise_for_status()
        t = Table(title="Evolution Candidates")
        t.add_column("ID", style="dim")
        t.add_column("Type")
        t.add_column("Score")
        t.add_column("Rationale")
        for e in r.json():
            t.add_row(
                e["id"][:8] + "...",
                e["type"],
                str(e.get("eval_score") or "—"),
                (e.get("rationale") or "")[:60],
            )
        console.print(t)

    asyncio.run(_inner())


@app.command("evolution-approve")
def evolution_approve(
    candidate_id: str = typer.Argument(),
    api_url: str = typer.Option("http://localhost:3000", envvar="CONFLUX_API_URL"),
    api_key: str = typer.Option("", envvar="CONFLUX_API_KEY"),
):
    """Approve an evolution candidate."""

    async def _inner():
        async with httpx.AsyncClient(
            base_url=api_url,
            headers=_h(api_key),
            timeout=30,
        ) as c:
            r = await c.post(f"/v1/admin/evolution-candidates/{candidate_id}/approve")
            r.raise_for_status()
        console.print("[green]✓[/green] Evolution candidate approved and applied")

    asyncio.run(_inner())


@app.command("reflection-list")
def reflection_list(
    api_url: str = typer.Option("http://localhost:3000", envvar="CONFLUX_API_URL"),
    api_key: str = typer.Option("", envvar="CONFLUX_API_KEY"),
):
    """List recent reflection jobs."""

    async def _inner():
        async with httpx.AsyncClient(
            base_url=api_url,
            headers=_h(api_key),
            timeout=30,
        ) as c:
            r = await c.get("/v1/admin/reflection-jobs")
            r.raise_for_status()
        t = Table(title="Reflection Jobs")
        t.add_column("ID", style="dim")
        t.add_column("Run ID")
        t.add_column("Status")
        t.add_column("Memories")
        t.add_column("Skills")
        for j in r.json():
            t.add_row(
                j["id"][:8] + "...",
                j["run_id"][:8] + "...",
                j["status"],
                str(len(j.get("memories") or [])),
                str(len(j.get("skills") or [])),
            )
        console.print(t)

    asyncio.run(_inner())
