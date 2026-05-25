"""HTTP fetch tool — retrieve content from URLs."""
from __future__ import annotations

import aiohttp

from conflux.tools.registry import ToolDefinition, ToolRegistry


async def _http_fetch(args: dict, context) -> dict:
    url = str(args.get("url", "")).strip()
    method = str(args.get("method", "GET")).upper()
    headers = args.get("headers", {})
    body = args.get("body")

    if not url:
        return {"error": "url is required"}

    if not isinstance(headers, dict):
        return {"error": "headers must be an object"}

    timeout = aiohttp.ClientTimeout(total=30)
    async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
        async with session.request(method, url, json=body if body is not None else None) as resp:
            text = await resp.text()
            return {
                "status": resp.status,
                "headers": dict(resp.headers),
                "body": text[:5000],
                "url": str(resp.url),
            }


def register(registry: ToolRegistry) -> None:
    registry.register(
        ToolDefinition(
            name="http_fetch",
            description="Make an HTTP request to a URL and return the response.",
            parameters={
                "type": "object",
                "properties": {
                    "url": {"type": "string"},
                    "method": {
                        "type": "string",
                        "enum": ["GET", "POST", "PUT", "DELETE", "PATCH"],
                        "default": "GET",
                    },
                    "headers": {"type": "object", "default": {}},
                    "body": {
                        "type": "object",
                        "description": "Request body (for POST/PUT/PATCH)",
                    },
                },
                "required": ["url"],
            },
            risk_level="moderate",
            fn=_http_fetch,
        )
    )
