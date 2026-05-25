"""AgentMail tools for inbox and message management."""
from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit, urlunsplit

from agentmail import AsyncAgentMail
from agentmail.environment import AgentMailEnvironment

from conflux.core.config import get_settings
from conflux.tools.registry import ToolDefinition, ToolRegistry


_AGENTMAIL_CONFIG_ERROR = (
    "AgentMail API key not configured. Set AGENTMAIL_API_KEY in environment."
)


def _normalize_agentmail_http_base(api_url: str) -> str:
    base = (api_url or AgentMailEnvironment.PROD.http).strip().rstrip("/")
    if base.endswith("/v0"):
        base = base[:-3].rstrip("/")
    return base or AgentMailEnvironment.PROD.http


def _derive_agentmail_websocket_base(http_base: str) -> str:
    parsed = urlsplit(http_base)
    host = parsed.netloc
    if host.startswith("x402.api."):
        host = f"x402.ws.{host[len('x402.api.') :]}"
    elif host.startswith("mpp.api."):
        host = f"mpp.ws.{host[len('mpp.api.') :]}"
    elif host.startswith("api."):
        host = f"ws.{host[len('api.') :]}"
    scheme = "wss" if parsed.scheme == "https" else "ws"
    return urlunsplit((scheme, host, "", "", ""))


def _get_client() -> AsyncAgentMail | None:
    settings = get_settings()
    if not settings.agentmail_api_key:
        return None

    http_base = _normalize_agentmail_http_base(settings.agentmail_api_url)
    environment = (
        AgentMailEnvironment.PROD
        if http_base == AgentMailEnvironment.PROD.http
        else AgentMailEnvironment(
            http=http_base,
            websockets=_derive_agentmail_websocket_base(http_base),
        )
    )
    return AsyncAgentMail(api_key=settings.agentmail_api_key, environment=environment)


def _serialize(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json", by_alias=True, exclude_none=True)
    if isinstance(value, dict):
        return {key: _serialize(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_serialize(item) for item in value]
    return value


def _limit(value: Any, default: int = 20) -> int:
    try:
        limit = int(value)
    except (TypeError, ValueError):
        return default
    return max(1, min(limit, 100))


def _required_string(args: dict[str, Any], key: str) -> str:
    value = str(args.get(key, "")).strip()
    if not value:
        raise ValueError(f"{key} is required")
    return value


def _optional_string(args: dict[str, Any], key: str) -> str | None:
    value = args.get(key)
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _string_list(value: Any, key: str, required: bool = False) -> list[str] | None:
    if value is None:
        if required:
            raise ValueError(f"{key} is required")
        return None
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        raise ValueError(f"{key} must be an array of strings")
    items = [str(item).strip() for item in value if str(item).strip()]
    if required and not items:
        raise ValueError(f"{key} must contain at least one value")
    return items or None


async def _create_inbox(args: dict[str, Any], context) -> dict[str, Any]:
    client = _get_client()
    if client is None:
        return {"error": _AGENTMAIL_CONFIG_ERROR}

    request: dict[str, Any] = {}
    if display_name := _optional_string(args, "display_name"):
        request["display_name"] = display_name
    if username := _optional_string(args, "username"):
        request["username"] = username

    try:
        inbox = await client.inboxes.create(request=request or None)
        return {
            "inbox_id": inbox.inbox_id,
            "email_address": inbox.email,
            "display_name": inbox.display_name,
        }
    except Exception as exc:
        return {"error": str(exc)}


async def _list_inboxes(args: dict[str, Any], context) -> dict[str, Any]:
    client = _get_client()
    if client is None:
        return {"error": _AGENTMAIL_CONFIG_ERROR}

    try:
        result = await client.inboxes.list(limit=_limit(args.get("limit"), 20))
        return {
            "count": result.count,
            "limit": result.limit,
            "next_page_token": result.next_page_token,
            "inboxes": _serialize(result.inboxes),
        }
    except Exception as exc:
        return {"error": str(exc)}


async def _send_message(args: dict[str, Any], context) -> dict[str, Any]:
    client = _get_client()
    if client is None:
        return {"error": _AGENTMAIL_CONFIG_ERROR}

    try:
        payload: dict[str, Any] = {
            "inbox_id": _required_string(args, "inbox_id"),
            "to": _string_list(args.get("to"), "to", required=True),
            "subject": _required_string(args, "subject"),
            "text": _required_string(args, "text"),
        }
        if html := _optional_string(args, "html"):
            payload["html"] = html
        if cc := _string_list(args.get("cc"), "cc"):
            payload["cc"] = cc
        if bcc := _string_list(args.get("bcc"), "bcc"):
            payload["bcc"] = bcc

        response = await client.inboxes.messages.send(**payload)
        return _serialize(response)
    except Exception as exc:
        return {"error": str(exc)}


async def _list_messages(args: dict[str, Any], context) -> dict[str, Any]:
    client = _get_client()
    if client is None:
        return {"error": _AGENTMAIL_CONFIG_ERROR}

    try:
        result = await client.inboxes.messages.list(
            inbox_id=_required_string(args, "inbox_id"),
            limit=_limit(args.get("limit"), 20),
        )
        return {
            "count": result.count,
            "limit": result.limit,
            "next_page_token": result.next_page_token,
            "messages": _serialize(result.messages),
        }
    except Exception as exc:
        return {"error": str(exc)}


async def _get_message(args: dict[str, Any], context) -> dict[str, Any]:
    client = _get_client()
    if client is None:
        return {"error": _AGENTMAIL_CONFIG_ERROR}

    try:
        message = await client.inboxes.messages.get(
            inbox_id=_required_string(args, "inbox_id"),
            message_id=_required_string(args, "message_id"),
        )
        return _serialize(message)
    except Exception as exc:
        return {"error": str(exc)}


async def _list_threads(args: dict[str, Any], context) -> dict[str, Any]:
    client = _get_client()
    if client is None:
        return {"error": _AGENTMAIL_CONFIG_ERROR}

    try:
        result = await client.inboxes.threads.list(
            inbox_id=_required_string(args, "inbox_id"),
            limit=_limit(args.get("limit"), 20),
        )
        return {
            "count": result.count,
            "limit": result.limit,
            "next_page_token": result.next_page_token,
            "threads": _serialize(result.threads),
        }
    except Exception as exc:
        return {"error": str(exc)}


async def _get_thread(args: dict[str, Any], context) -> dict[str, Any]:
    client = _get_client()
    if client is None:
        return {"error": _AGENTMAIL_CONFIG_ERROR}

    try:
        thread = await client.inboxes.threads.get(
            inbox_id=_required_string(args, "inbox_id"),
            thread_id=_required_string(args, "thread_id"),
        )
        return _serialize(thread)
    except Exception as exc:
        return {"error": str(exc)}


async def _reply_to_thread(args: dict[str, Any], context) -> dict[str, Any]:
    client = _get_client()
    if client is None:
        return {"error": _AGENTMAIL_CONFIG_ERROR}

    try:
        inbox_id = _required_string(args, "inbox_id")
        thread = await client.inboxes.threads.get(
            inbox_id=inbox_id,
            thread_id=_required_string(args, "thread_id"),
        )
        payload: dict[str, Any] = {
            "inbox_id": inbox_id,
            "message_id": thread.last_message_id,
            "reply_all": True,
            "text": _required_string(args, "text"),
        }
        if html := _optional_string(args, "html"):
            payload["html"] = html

        response = await client.inboxes.messages.reply(**payload)
        data = _serialize(response)
        data["thread_id"] = data.get("thread_id") or thread.thread_id
        data["replied_to_message_id"] = thread.last_message_id
        return data
    except Exception as exc:
        return {"error": str(exc)}


async def _create_draft(args: dict[str, Any], context) -> dict[str, Any]:
    client = _get_client()
    if client is None:
        return {"error": _AGENTMAIL_CONFIG_ERROR}

    try:
        payload: dict[str, Any] = {
            "inbox_id": _required_string(args, "inbox_id"),
            "to": _string_list(args.get("to"), "to", required=True),
            "subject": _required_string(args, "subject"),
            "text": _required_string(args, "text"),
        }
        if html := _optional_string(args, "html"):
            payload["html"] = html

        draft = await client.inboxes.drafts.create(**payload)
        return _serialize(draft)
    except Exception as exc:
        return {"error": str(exc)}


def register(registry: ToolRegistry) -> None:
    registry.register(
        ToolDefinition(
            name="agentmail_create_inbox",
            description="Create a new AgentMail inbox for an agent.",
            parameters={
                "type": "object",
                "properties": {
                    "display_name": {"type": "string", "description": "Inbox display name"},
                    "username": {
                        "type": "string",
                        "description": "Desired username before the @ sign",
                    },
                },
            },
            risk_level="moderate",
            fn=_create_inbox,
        )
    )
    registry.register(
        ToolDefinition(
            name="agentmail_list_inboxes",
            description="List AgentMail inboxes available to the configured account.",
            parameters={
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of inboxes to return",
                        "default": 20,
                    }
                },
            },
            risk_level="safe",
            fn=_list_inboxes,
        )
    )
    registry.register(
        ToolDefinition(
            name="agentmail_send_message",
            description="Send an outbound email from an AgentMail inbox.",
            parameters={
                "type": "object",
                "properties": {
                    "inbox_id": {"type": "string"},
                    "to": {"type": "array", "items": {"type": "string"}},
                    "subject": {"type": "string"},
                    "text": {"type": "string"},
                    "html": {"type": "string"},
                    "cc": {"type": "array", "items": {"type": "string"}},
                    "bcc": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["inbox_id", "to", "subject", "text"],
            },
            risk_level="moderate",
            fn=_send_message,
        )
    )
    registry.register(
        ToolDefinition(
            name="agentmail_list_messages",
            description="List recent messages from an AgentMail inbox.",
            parameters={
                "type": "object",
                "properties": {
                    "inbox_id": {"type": "string"},
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of messages to return",
                        "default": 20,
                    },
                },
                "required": ["inbox_id"],
            },
            risk_level="safe",
            fn=_list_messages,
        )
    )
    registry.register(
        ToolDefinition(
            name="agentmail_get_message",
            description="Get a full AgentMail message including message body content.",
            parameters={
                "type": "object",
                "properties": {
                    "inbox_id": {"type": "string"},
                    "message_id": {"type": "string"},
                },
                "required": ["inbox_id", "message_id"],
            },
            risk_level="safe",
            fn=_get_message,
        )
    )
    registry.register(
        ToolDefinition(
            name="agentmail_list_threads",
            description="List recent email threads from an AgentMail inbox.",
            parameters={
                "type": "object",
                "properties": {
                    "inbox_id": {"type": "string"},
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of threads to return",
                        "default": 20,
                    },
                },
                "required": ["inbox_id"],
            },
            risk_level="safe",
            fn=_list_threads,
        )
    )
    registry.register(
        ToolDefinition(
            name="agentmail_get_thread",
            description="Get a full AgentMail thread including its messages.",
            parameters={
                "type": "object",
                "properties": {
                    "inbox_id": {"type": "string"},
                    "thread_id": {"type": "string"},
                },
                "required": ["inbox_id", "thread_id"],
            },
            risk_level="safe",
            fn=_get_thread,
        )
    )
    registry.register(
        ToolDefinition(
            name="agentmail_reply_to_thread",
            description="Reply to the most recent message in an AgentMail thread.",
            parameters={
                "type": "object",
                "properties": {
                    "inbox_id": {"type": "string"},
                    "thread_id": {"type": "string"},
                    "text": {"type": "string"},
                    "html": {"type": "string"},
                },
                "required": ["inbox_id", "thread_id", "text"],
            },
            risk_level="moderate",
            fn=_reply_to_thread,
        )
    )
    registry.register(
        ToolDefinition(
            name="agentmail_create_draft",
            description="Create a draft email in an AgentMail inbox.",
            parameters={
                "type": "object",
                "properties": {
                    "inbox_id": {"type": "string"},
                    "to": {"type": "array", "items": {"type": "string"}},
                    "subject": {"type": "string"},
                    "text": {"type": "string"},
                    "html": {"type": "string"},
                },
                "required": ["inbox_id", "to", "subject", "text"],
            },
            risk_level="moderate",
            fn=_create_draft,
        )
    )
