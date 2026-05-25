"""Shell execution tool — guarded by DATA_GUARD_ENABLED."""
from __future__ import annotations

import asyncio

from conflux.tools.registry import ToolDefinition, ToolRegistry


async def _shell_exec(args: dict, context) -> dict:
    """Execute a shell command. Blocked when DATA_GUARD_ENABLED=true."""
    command = str(args.get("command", "")).strip()
    if not command:
        return {"error": "command is required"}

    try:
        timeout = max(1, min(int(args.get("timeout", 30)), 120))
    except (TypeError, ValueError):
        timeout = 30

    proc = await asyncio.create_subprocess_shell(
        command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.communicate()
        return {"error": f"Command timed out after {timeout}s", "command": command}

    return {
        "stdout": stdout.decode(errors="replace").strip(),
        "stderr": stderr.decode(errors="replace").strip(),
        "returncode": proc.returncode,
        "command": command,
    }


def register(registry: ToolRegistry) -> None:
    registry.register(
        ToolDefinition(
            name="shell_exec",
            description="Execute a shell command. Use for running scripts, checking status, or automation tasks.",
            parameters={
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "Shell command to execute"},
                    "timeout": {
                        "type": "integer",
                        "description": "Timeout in seconds (max 120)",
                        "default": 30,
                    },
                },
                "required": ["command"],
            },
            risk_level="destructive",
            requires_approval=True,
            fn=_shell_exec,
        )
    )
