"""skill commands."""
import asyncio

import httpx
import typer
from rich.console import Console
from rich.markdown import Markdown
from rich.table import Table

app = typer.Typer(no_args_is_help=True)
console = Console()


def _h(k: str) -> dict:
    return {"X-API-Key": k} if k else {}


@app.command("list")
def list_skills(
    api_url: str = typer.Option("http://localhost:3000", envvar="CONFLUX_API_URL"),
    api_key: str = typer.Option("", envvar="CONFLUX_API_KEY"),
):
    """List approved skills."""

    async def _inner():
        async with httpx.AsyncClient(
            base_url=api_url,
            headers=_h(api_key),
            timeout=30,
        ) as c:
            r = await c.get("/v1/skills")
            r.raise_for_status()
        t = Table(title="Skills")
        t.add_column("Slug", style="cyan")
        t.add_column("Name")
        t.add_column("Category")
        t.add_column("Status")
        for s in r.json():
            t.add_row(
                s.get("slug", ""),
                s.get("name", ""),
                s.get("category", ""),
                s.get("status", ""),
            )
        console.print(t)

    asyncio.run(_inner())


@app.command("get")
def get_skill(
    slug: str = typer.Argument(),
    api_url: str = typer.Option("http://localhost:3000", envvar="CONFLUX_API_URL"),
    api_key: str = typer.Option("", envvar="CONFLUX_API_KEY"),
):
    """Show skill content."""

    async def _inner():
        async with httpx.AsyncClient(
            base_url=api_url,
            headers=_h(api_key),
            timeout=30,
        ) as c:
            r = await c.get(f"/v1/skills/{slug}")
            r.raise_for_status()
        data = r.json()
        console.print(f"\n[bold]{data['name']}[/bold] [dim]v{data.get('version')}[/dim]")
        console.print(f"[dim]{data['description']}[/dim]\n")
        console.print(Markdown(data.get("content", "")))

    asyncio.run(_inner())


@app.command("pending")
def pending_skills(
    api_url: str = typer.Option("http://localhost:3000", envvar="CONFLUX_API_URL"),
    api_key: str = typer.Option("", envvar="CONFLUX_API_KEY"),
):
    """List skills pending approval (admin)."""

    async def _inner():
        async with httpx.AsyncClient(
            base_url=api_url,
            headers=_h(api_key),
            timeout=30,
        ) as c:
            r = await c.get("/v1/skills/pending")
            r.raise_for_status()
        t = Table(title="Pending Skills")
        t.add_column("ID", style="dim")
        t.add_column("Name")
        t.add_column("Slug")
        t.add_column("Status")
        for s in r.json():
            t.add_row(s["id"][:8] + "...", s["name"], s["slug"], s["status"])
        console.print(t)

    asyncio.run(_inner())


@app.command("approve")
def approve_skill(
    skill_id: str = typer.Argument(),
    api_url: str = typer.Option("http://localhost:3000", envvar="CONFLUX_API_URL"),
    api_key: str = typer.Option("", envvar="CONFLUX_API_KEY"),
):
    """Approve a skill (admin)."""

    async def _inner():
        async with httpx.AsyncClient(
            base_url=api_url,
            headers=_h(api_key),
            timeout=30,
        ) as c:
            r = await c.post(f"/v1/skills/{skill_id}/approve")
            r.raise_for_status()
        console.print("[green]✓[/green] Skill approved")

    asyncio.run(_inner())
