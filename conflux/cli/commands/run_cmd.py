"""run commands — execute agent tasks from the CLI."""
import asyncio
import json

import httpx
import typer
from rich.console import Console
from rich.table import Table

app = typer.Typer(no_args_is_help=True)
console = Console()


def _headers(api_key: str) -> dict:
    return {"X-API-Key": api_key} if api_key else {}


@app.command("task")
def run_task(
    agent: str = typer.Argument(help="Agent ID"),
    message: str = typer.Argument(help="Task message"),
    no_stream: bool = typer.Option(False, "--no-stream"),
    api_url: str = typer.Option("http://localhost:3000", envvar="CONFLUX_API_URL"),
    api_key: str = typer.Option("", envvar="CONFLUX_API_KEY"),
):
    """Run a task on an agent. Streams output to terminal."""
    asyncio.run(_run_task(agent, message, api_url, api_key, stream=not no_stream))


async def _run_task(
    agent_id: str,
    message: str,
    api_url: str,
    api_key: str,
    stream: bool = True,
):
    async with httpx.AsyncClient(
        base_url=api_url,
        headers=_headers(api_key),
        timeout=300,
    ) as client:
        console.print(f"[dim]Creating run on agent: {agent_id}[/dim]")
        resp = await client.post(
            "/v1/runs",
            json={
                "agent_id": agent_id,
                "messages": [{"role": "user", "content": message}],
                "stream": stream,
            },
        )
        resp.raise_for_status()
        run_data = resp.json()
        run_id = run_data["run_id"]
        console.print(f"[dim]Run ID: {run_id}[/dim]\n")

        if not stream:
            console.print(f"[yellow]Run queued: {run_id}[/yellow]")
            return

        console.print("[bold cyan]Agent Response:[/bold cyan]")
        event_type = ""
        full_response = ""

        async with client.stream("GET", f"/v1/runs/{run_id}/stream") as stream_resp:
            async for line in stream_resp.aiter_lines():
                if not line:
                    continue
                if line.startswith("event: "):
                    event_type = line[7:].strip()
                elif line.startswith("data: "):
                    try:
                        data = json.loads(line[6:])
                    except json.JSONDecodeError:
                        continue
                    if event_type == "token":
                        content = data.get("content", "")
                        console.print(content, end="")
                        full_response += content
                    elif event_type == "tool_call":
                        console.print(
                            f"\n[bold yellow]⚙ {data.get('name')}[/bold yellow] "
                            f"{str(data.get('args', {}))[:80]}"
                        )
                    elif event_type == "tool_result":
                        console.print(
                            f"[dim]  → {str(data.get('result', ''))[:80]}[/dim]"
                        )
                    elif event_type == "error":
                        console.print(
                            f"\n[bold red]Error:[/bold red] {data.get('message')}"
                        )
                    elif event_type == "done":
                        console.print()
                        if full_response.strip():
                            from rich.markdown import Markdown
                            from rich.rule import Rule

                            console.print(Rule("[dim]Rendered[/dim]", style="dim"))
                            console.print(Markdown(full_response))
                        break


@app.command("status")
def run_status(
    run_id: str = typer.Argument(),
    api_url: str = typer.Option("http://localhost:3000", envvar="CONFLUX_API_URL"),
    api_key: str = typer.Option("", envvar="CONFLUX_API_KEY"),
):
    """Check status of a run."""

    async def _inner():
        async with httpx.AsyncClient(
            base_url=api_url,
            headers=_headers(api_key),
            timeout=30,
        ) as client:
            resp = await client.get(f"/v1/runs/{run_id}")
            resp.raise_for_status()
            r = resp.json()
        status_style = {
            "completed": "green",
            "failed": "red",
            "running": "yellow",
            "queued": "dim",
        }.get(r["status"], "white")
        table = Table(title=f"Run {run_id[:8]}...")
        table.add_column("Field", style="cyan")
        table.add_column("Value")
        table.add_row("Status", f"[{status_style}]{r['status']}[/{status_style}]")
        table.add_row("Agent", r.get("agent_id", "")[:36])
        table.add_row("Started", r.get("started_at") or "—")
        table.add_row("Completed", r.get("completed_at") or "—")
        if r.get("output"):
            table.add_row("Output", str(r["output"])[:200])
        console.print(table)

    asyncio.run(_inner())


@app.command("list")
def list_runs(
    limit: int = typer.Option(10, "-n"),
    api_url: str = typer.Option("http://localhost:3000", envvar="CONFLUX_API_URL"),
    api_key: str = typer.Option("", envvar="CONFLUX_API_KEY"),
):
    """List recent runs."""

    async def _inner():
        async with httpx.AsyncClient(
            base_url=api_url,
            headers=_headers(api_key),
            timeout=30,
        ) as client:
            resp = await client.get(f"/v1/runs?limit={limit}")
            resp.raise_for_status()
            runs = resp.json()
        table = Table(title="Recent Runs")
        table.add_column("ID", style="dim")
        table.add_column("Status")
        table.add_column("Agent")
        table.add_column("Created")
        for r in runs:
            s = r["status"]
            style = {
                "completed": "green",
                "failed": "red",
                "running": "yellow",
            }.get(s, "white")
            table.add_row(
                r["id"][:8] + "...",
                f"[{style}]{s}[/{style}]",
                r.get("agent_id", "")[:16],
                r.get("created_at", "")[:19],
            )
        console.print(table)

    asyncio.run(_inner())
