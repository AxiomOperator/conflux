"""Telegram channel adapter.

Each incoming message is resolved to a Conflux user via the TelegramLink table
(established with /link <api_key>), then run through AgentLoop directly — the
same execution path used by /v1/runs/{run_id}/stream.
"""
from __future__ import annotations

import asyncio
import hashlib
import re
import urllib.parse as _urlparse
from uuid import UUID, uuid4

import structlog
from telegram import BotCommand, InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

from conflux.core.config import get_settings as _get_settings_fn

logger = structlog.get_logger(__name__)

_redis_client = None


async def _get_redis():
    """Get or create a shared Redis/DragonflyDB client."""
    global _redis_client
    if _redis_client is None:
        from redis.asyncio import Redis

        _s = _get_settings_fn()
        _parsed = _urlparse.urlparse(_s.dragonfly_url)
        _redis_client = Redis(
            host=_parsed.hostname or "localhost",
            port=_parsed.port or 6379,
            password=_parsed.password or _s.dragonfly_password or None,
            decode_responses=True,
        )
    return _redis_client


_HISTORY_MAX = 40  # max messages to keep per user
_HISTORY_TTL = 604800  # 7 days in seconds
_HISTORY_KEY = "telegram:history:{}"  # format with telegram_user_id


async def _load_history(telegram_user_id: int) -> list[dict]:
    """Load conversation history from DragonflyDB."""
    import json

    redis = await _get_redis()
    key = _HISTORY_KEY.format(telegram_user_id)
    raw_msgs = await redis.lrange(key, 0, -1)
    messages = []
    for raw in raw_msgs:
        try:
            messages.append(json.loads(raw))
        except Exception:
            pass
    return messages


async def _save_to_history(telegram_user_id: int, role: str, content: str) -> None:
    """Append a message to conversation history and trim to max length."""
    import json

    redis = await _get_redis()
    key = _HISTORY_KEY.format(telegram_user_id)
    await redis.rpush(key, json.dumps({"role": role, "content": content}))
    await redis.ltrim(key, -_HISTORY_MAX, -1)
    await redis.expire(key, _HISTORY_TTL)


async def _clear_history(telegram_user_id: int) -> None:
    """Delete conversation history for a user."""
    redis = await _get_redis()
    key = _HISTORY_KEY.format(telegram_user_id)
    await redis.delete(key)


_TELEGRAM_SYSTEM_SUFFIX = """
---
TELEGRAM CHANNEL INSTRUCTIONS (apply to this conversation only):
- Use standard markdown formatting: **bold**, *italic*, `code`, ```code blocks```, and - bullet lists.
- Keep responses concise and mobile-friendly.
- Do NOT output raw HTML tags.
"""


# ---------------------------------------------------------------------------
# Markdown → Telegram HTML converter
# ---------------------------------------------------------------------------

def _escape_html(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _format_inline(text: str) -> str:
    """Convert inline markdown (bold, italic, code, links) to Telegram HTML."""
    # Split on inline code spans first to avoid mangling them
    segments = re.split(r"(`[^`\n]+?`)", text)
    parts: list[str] = []
    for seg in segments:
        if seg.startswith("`") and seg.endswith("`") and len(seg) > 2:
            parts.append(f"<code>{_escape_html(seg[1:-1])}</code>")
        else:
            s = _escape_html(seg)
            # Bold **text** or __text__
            s = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s, flags=re.DOTALL)
            s = re.sub(r"__(.+?)__", r"<b>\1</b>", s, flags=re.DOTALL)
            # Italic *text* or _text_ (word-boundary guard for _)
            s = re.sub(r"\*([^*\n]+?)\*", r"<i>\1</i>", s)
            s = re.sub(r"(?<!\w)_([^_\n]+?)_(?!\w)", r"<i>\1</i>", s)
            # Links [text](url)
            s = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', s)
            parts.append(s)
    return "".join(parts)


_HTML_TAG_RE = re.compile(r"<(b|i|u|s|code|pre|a)[\s>]", re.IGNORECASE)


def _md_to_telegram_html(text: str) -> str:
    """Convert standard markdown to Telegram HTML (parse_mode='HTML').

    If the agent already output Telegram-compatible HTML tags, return the text
    as-is rather than escaping the angle brackets.
    """
    if _HTML_TAG_RE.search(text):
        # Already HTML — return directly; no conversion needed
        return text

    lines = text.split("\n")
    result: list[str] = []
    in_code_block = False
    code_lang = ""
    code_lines: list[str] = []

    for line in lines:
        # Fenced code blocks
        fence = re.match(r"^```(\w*)", line)
        if fence:
            if not in_code_block:
                in_code_block = True
                code_lang = fence.group(1)
                code_lines = []
            else:
                in_code_block = False
                code_content = _escape_html("\n".join(code_lines))
                result.append(f"<pre><code>{code_content}</code></pre>")
            continue

        if in_code_block:
            code_lines.append(line)
            continue

        # Horizontal rules
        if re.match(r"^[-*_]{3,}\s*$", line):
            result.append("──────────")
            continue

        # ATX headers → bold
        hm = re.match(r"^(#{1,6})\s+(.*)", line)
        if hm:
            result.append(f"<b>{_format_inline(hm.group(2))}</b>")
            continue

        # Unordered list items (-, *, +)
        lm = re.match(r"^(\s*)[-*+] (.*)", line)
        if lm:
            indent = len(lm.group(1)) // 2
            bullet = "  " * indent + "•"
            result.append(f"{bullet} {_format_inline(lm.group(2))}")
            continue

        # Ordered list items
        olm = re.match(r"^(\s*)(\d+)\. (.*)", line)
        if olm:
            result.append(f"{olm.group(2)}. {_format_inline(olm.group(3))}")
            continue

        # Blockquotes
        if line.startswith("> "):
            result.append(f"<i>{_format_inline(line[2:])}</i>")
            continue

        # Plain line
        result.append(_format_inline(line))

    return "\n".join(result)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _resolve_user(telegram_user_id: int):
    """Return (User, agent) for the linked Conflux account, or None."""
    from sqlalchemy import select

    from conflux.core.database import get_db_session
    from conflux.models.agent import Agent
    from conflux.models.user import TelegramLink, User

    async with get_db_session() as db:
        result = await db.execute(
            select(TelegramLink).where(TelegramLink.telegram_user_id == telegram_user_id)
        )
        link = result.scalar_one_or_none()
        if not link:
            return None, None

        user_result = await db.execute(select(User).where(User.id == link.user_id))
        user = user_result.scalar_one_or_none()
        if not user or not user.is_active:
            return None, None

        redis = await _get_redis()
        preferred_agent_id = await redis.get(f"telegram:agent_pref:{telegram_user_id}")
        if preferred_agent_id:
            pref_result = await db.execute(
                select(Agent).where(Agent.id == UUID(preferred_agent_id), Agent.is_enabled.is_(True))
            )
            pref_agent = pref_result.scalar_one_or_none()
            if pref_agent:
                return user, pref_agent

        # Prefer orchestrator agent; fall back to any enabled agent
        agent_result = await db.execute(
            select(Agent)
            .where(Agent.is_enabled.is_(True))
            .order_by(
                (Agent.agent_type == "orchestrator").desc(),
                Agent.created_at.asc(),
            )
            .limit(1)
        )
        agent = agent_result.scalar_one_or_none()
        return user, agent


async def _run_agent_loop(
    user_id: str,
    tenant_id: str | None,
    agent,
    text: str,
    history: list[dict] | None = None,
) -> str:
    """Create a run record and execute AgentLoop, returning the final text."""
    from sqlalchemy import select

    from conflux.agents.base import AgentConfig, RunContext
    from conflux.agents.loop import AgentLoop
    from conflux.core.database import get_db_session
    from conflux.models.agent import AgentRun

    run_id = uuid4()

    async with get_db_session() as db:
        run = AgentRun(
            id=run_id,
            agent_id=agent.id,
            user_id=UUID(user_id),
            status="queued",
            input={"messages": [{"role": "user", "content": text}]},
        )
        db.add(run)
        await db.flush()

    # Append Telegram-specific formatting instructions to the system prompt
    base_prompt = agent.system_prompt or ""
    telegram_prompt = base_prompt + _TELEGRAM_SYSTEM_SUFFIX

    config = AgentConfig(
        agent_id=str(agent.id),
        name=agent.name,
        agent_type=agent.agent_type,
        system_prompt=telegram_prompt,
        model_policy=agent.model_policy or {},
        tool_allowlist=agent.tool_allowlist or [],
        retrieval_tags=agent.retrieval_tags or [],
        max_iterations=agent.max_iterations,
        wiki_rag_enabled=agent.wiki_rag_enabled,
    )
    all_messages = list(history or [])
    all_messages.append({"role": "user", "content": text})

    context = RunContext(
        run_id=str(run_id),
        user_id=user_id,
        session_id=None,
        tenant_id=tenant_id,
        project_id=None,
        input_messages=all_messages,
    )

    final_content = ""
    loop_inst = AgentLoop(config=config, context=context)
    async for event in loop_inst.run():
        if event.event_type == "done":
            final_content = event.data.get("content") or ""
        elif event.event_type == "error":
            final_content = f"⚠️ {event.data.get('message', 'An error occurred.')}"

    return final_content or "I completed the task but produced no text output."


# ---------------------------------------------------------------------------
# Command handlers
# ---------------------------------------------------------------------------

async def start_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text(
        "<b>👋 Welcome to Conflux!</b>\n\n"
        "I'm your AI agent assistant. To get started:\n\n"
        "1️⃣ Generate an API key in the Conflux web UI\n"
        "   <i>Settings → API Keys → Create</i>\n\n"
        "2️⃣ Link your account:\n"
        "   <code>/link YOUR_API_KEY</code>\n\n"
        "3️⃣ Start chatting! Just send any message.\n\n"
        "Use /help to see all available commands.",
        parse_mode="HTML",
    )


async def help_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text(
        "<b>📋 Conflux Bot Commands</b>\n\n"
        "<b>Account</b>\n"
        "/link &lt;api_key&gt; — Link your Conflux account\n"
        "/unlink — Remove your account link\n"
        "/me — Show your account &amp; active agent\n\n"
        "<b>Conversation</b>\n"
        "/new — Start a fresh conversation\n"
        "/compress — Summarize and shrink the current conversation\n"
        "/cancel — Cancel current operation\n\n"
        "<b>Agents</b>\n"
        "/agents — List &amp; switch AI agents\n\n"
        "<b>System</b>\n"
        "/status — Check Conflux status\n"
        "/help — Show this message\n\n"
        "💬 Or just send any message to chat with your AI agent!",
        parse_mode="HTML",
    )


async def new_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text("🆕 Conversation cleared! Starting fresh.")


async def cancel_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text("OK, cancelled.")


async def compress_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    from sqlalchemy import select

    from conflux.agents.compression import build_summary_system_message, summarize_messages
    from conflux.core.database import get_db_session
    from conflux.models.agent import AgentRun

    telegram_user_id = update.effective_user.id
    user, agent = await _resolve_user(telegram_user_id)
    if not user:
        await update.message.reply_text(
            "🔗 Your Telegram account isn't linked yet.\n\n"
            "Use <code>/link YOUR_API_KEY</code> to connect it.",
            parse_mode="HTML",
        )
        return

    history = await _load_history(telegram_user_id)
    if len(history) < 2:
        await update.message.reply_text("ℹ️ There isn't enough conversation history to compress yet.")
        return

    try:
        summary = await summarize_messages(history, agent=agent)
        await _clear_history(telegram_user_id)
        summary_message = build_summary_system_message(summary)
        await _save_to_history(telegram_user_id, summary_message["role"], summary_message["content"])

        async with get_db_session() as db:
            result = await db.execute(
                select(AgentRun)
                .where(AgentRun.user_id == user.id)
                .order_by(AgentRun.created_at.desc())
                .limit(1)
            )
            latest_run = result.scalar_one_or_none()
            if latest_run:
                latest_run.compressed_context = summary
                latest_run.is_compressed = True

        await update.message.reply_text(
            _md_to_telegram_html(f"✅ Conversation compressed.\n\n**Summary:** {summary}"),
            parse_mode="HTML",
        )
    except Exception as exc:
        logger.warning("telegram_compress_failed", error=str(exc), telegram_user_id=telegram_user_id)
        await update.message.reply_text("⚠️ Failed to compress this conversation. Please try again.")


async def me_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    telegram_user_id = update.effective_user.id
    user, agent = await _resolve_user(telegram_user_id)
    if not user:
        await update.message.reply_text(
            "🔗 Your Telegram account isn't linked yet.\n\n"
            "Use <code>/link YOUR_API_KEY</code> to connect it.",
            parse_mode="HTML",
        )
        return

    display = _escape_html(user.display_name or user.email)
    agent_name = _escape_html(agent.name if agent else "None configured")
    await update.message.reply_text(
        "<b>👤 Account:</b> " + display + "\n"
        "<b>🤖 Active Agent:</b> " + agent_name + "\n"
        "<b>✅ Status:</b> Linked",
        parse_mode="HTML",
    )


async def agents_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    from sqlalchemy import select

    from conflux.core.database import get_db_session
    from conflux.models.agent import Agent

    telegram_user_id = update.effective_user.id
    user, current_agent = await _resolve_user(telegram_user_id)
    if not user:
        await update.message.reply_text(
            "🔗 Your Telegram account isn't linked yet.\n\n"
            "Use <code>/link YOUR_API_KEY</code> to connect it.",
            parse_mode="HTML",
        )
        return

    async with get_db_session() as db:
        result = await db.execute(
            select(Agent).where(Agent.is_enabled.is_(True)).order_by(Agent.created_at.asc())
        )
        agents = result.scalars().all()

    if not agents:
        await update.message.reply_text("⚠️ No agents configured.")
        return

    current_agent_id = str(current_agent.id) if current_agent else None
    keyboard = [
        [
            InlineKeyboardButton(
                f"{'✅ ' if current_agent_id == str(agent.id) else ''}{agent.name}",
                callback_data=f"set_agent:{agent.id}",
            )
        ]
        for agent in agents
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    await update.message.reply_text(
        "🤖 <b>Available Agents</b> — tap one to switch:",
        parse_mode="HTML",
        reply_markup=reply_markup,
    )


async def link_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Pair this Telegram user to a Conflux account via API key."""
    from sqlalchemy import select

    from conflux.core.database import get_db_session
    from conflux.models.user import APIKey, TelegramLink, User

    settings = _get_settings_fn()
    telegram_user_id = update.effective_user.id

    args = context.args or []
    if not args:
        await update.message.reply_text(
            "Usage: /link <api_key>\n\nGenerate an API key from the Conflux web UI under Settings → API Keys."
        )
        return

    raw_key = args[0].strip()
    key_hash = hashlib.sha256(f"{settings.api_key_pepper}{raw_key}".encode()).hexdigest()

    try:
        async with get_db_session() as db:
            result = await db.execute(
                select(APIKey, User)
                .join(User, APIKey.user_id == User.id)
                .where(APIKey.key_hash == key_hash, APIKey.is_active.is_(True), User.is_active.is_(True))
            )
            row = result.first()
            if not row:
                await update.message.reply_text("❌ Invalid or inactive API key. Please check and try again.")
                return

            api_key_rec, user = row

            # Upsert telegram link
            existing = await db.execute(
                select(TelegramLink).where(TelegramLink.telegram_user_id == telegram_user_id)
            )
            link = existing.scalar_one_or_none()
            if link:
                link.user_id = user.id
                link.linked_via_key_id = api_key_rec.id
            else:
                db.add(
                    TelegramLink(
                        telegram_user_id=telegram_user_id,
                        user_id=user.id,
                        linked_via_key_id=api_key_rec.id,
                    )
                )

        display = _escape_html(user.display_name or user.email)
        await update.message.reply_text(
            f"✅ Linked! You are now connected as <b>{display}</b>.\n\nSend me any message to start chatting.",
            parse_mode="HTML",
        )
        logger.info("Telegram account linked", telegram_user_id=telegram_user_id, user_id=str(user.id))
    except Exception as e:
        logger.error("Telegram link failed", error=str(e), telegram_user_id=telegram_user_id)
        await update.message.reply_text("⚠️ An error occurred while linking your account. Please try again.")


async def unlink_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Remove the link for this Telegram user."""
    from sqlalchemy import delete

    from conflux.core.database import get_db_session
    from conflux.models.user import TelegramLink

    telegram_user_id = update.effective_user.id

    async with get_db_session() as db:
        result = await db.execute(
            delete(TelegramLink).where(TelegramLink.telegram_user_id == telegram_user_id)
        )
        removed = result.rowcount > 0

    if removed:
        await update.message.reply_text("🔓 Your Telegram account has been unlinked from Conflux.")
        logger.info("Telegram account unlinked", telegram_user_id=telegram_user_id)
    else:
        await update.message.reply_text("You don't have a linked account. Use /link <api_key> to get started.")


async def status_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    from conflux.core.database import get_db_session
    from sqlalchemy import text

    lines = []
    # DB check
    try:
        async with get_db_session() as db:
            await db.execute(text("SELECT 1"))
        lines.append("✅ <b>Database:</b> Online")
    except Exception as e:
        lines.append(f"❌ <b>Database:</b> {e}")

    # DragonflyDB / Redis check
    try:
        redis = await _get_redis()
        await redis.ping()
        lines.append("✅ <b>DragonflyDB:</b> Online")
    except Exception as e:
        lines.append(f"❌ <b>DragonflyDB:</b> {e}")

    # Linked account check
    user, agent = await _resolve_user(update.effective_user.id)
    if user:
        lines.append(f"👤 <b>Linked as:</b> {user.display_name or user.email}")
        lines.append(f"🤖 <b>Agent:</b> {agent.name if agent else 'None configured'}")
    else:
        lines.append("🔗 <b>Account:</b> Not linked — use /link &lt;api_key&gt;")

    await update.message.reply_text(
        "<b>🔍 Conflux Status</b>\n\n" + "\n".join(lines),
        parse_mode="HTML",
    )


async def agent_callback_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    await query.answer()
    data = query.data or ""
    if not data.startswith("set_agent:"):
        return

    agent_id = data.split(":", 1)[1]
    telegram_user_id = query.from_user.id

    redis = await _get_redis()
    await redis.set(f"telegram:agent_pref:{telegram_user_id}", agent_id, ex=86400 * 90)

    from sqlalchemy import select

    from conflux.core.database import get_db_session
    from conflux.models.agent import Agent

    async with get_db_session() as db:
        result = await db.execute(select(Agent).where(Agent.id == UUID(agent_id)))
        agent = result.scalar_one_or_none()

    name = _escape_html(agent.name if agent else agent_id)
    await query.edit_message_text(f"✅ Switched to agent: <b>{name}</b>", parse_mode="HTML")


async def message_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    from telegram import ReactionTypeEmoji

    settings = _get_settings_fn()
    telegram_user_id = update.effective_user.id

    if settings.telegram_allowed_ids and telegram_user_id not in settings.telegram_allowed_ids:
        await update.message.reply_text("⛔ You are not authorized to use this bot.")
        return

    text = update.message.text or ""
    if not text:
        await update.message.reply_text("Please send a text message.")
        return

    user, agent = await _resolve_user(telegram_user_id)
    if not user:
        await update.message.reply_text(
            "👋 Your Telegram account isn't linked yet.\n\n"
            "Use /link <api_key> to connect it to your Conflux account.\n"
            "Generate an API key from the Conflux web UI under Settings → API Keys."
        )
        return

    if not agent:
        await update.message.reply_text("⚠️ No active agent found. Please configure an agent in Conflux.")
        return

    # React immediately to acknowledge receipt, then show typing indicator
    try:
        await context.bot.set_message_reaction(
            chat_id=update.effective_chat.id,
            message_id=update.effective_message.message_id,
            reaction=[ReactionTypeEmoji("👍")],
        )
    except Exception:
        pass  # Reactions aren't supported in all chat types — ignore silently

    await context.bot.send_chat_action(chat_id=update.effective_chat.id, action="typing")

    history = []
    try:
        history = await _load_history(telegram_user_id)
    except Exception as e:
        logger.warning("Failed to load telegram history", error=str(e))

    try:
        answer = await _run_agent_loop(
            user_id=str(user.id),
            tenant_id=str(user.personal_tenant_id) if user.personal_tenant_id else None,
            agent=agent,
            text=text,
            history=history,
        )
    except Exception as e:
        logger.error("Telegram agent loop failed", error=str(e), telegram_user_id=telegram_user_id)
        answer = "Sorry, I encountered an error processing your message. Please try again."

    try:
        await _save_to_history(telegram_user_id, "user", text)
        await _save_to_history(telegram_user_id, "assistant", answer)
    except Exception as e:
        logger.warning("Failed to save telegram history", error=str(e))

    # Safety: if the agent wrapped the entire response in a single code fence, unwrap it
    stripped = answer.strip()
    if stripped.startswith("```") and stripped.endswith("```") and stripped.count("```") == 2:
        answer = stripped[3:].lstrip("\n")
        if answer.endswith("```"):
            answer = answer[:-3].rstrip()

    html = _md_to_telegram_html(answer)
    i = 0
    for chunk in [html[j : j + 4096] for j in range(0, len(html), 4096)]:
        try:
            await update.message.reply_text(chunk, parse_mode="HTML")
        except Exception:
            # Fall back to plain text if HTML parse fails (e.g. malformed tags)
            plain = answer[i : i + 4096]
            await update.message.reply_text(plain)
        i += 4096


# ---------------------------------------------------------------------------
# App factory + runner
# ---------------------------------------------------------------------------

def create_telegram_app() -> Application:
    settings = _get_settings_fn()
    if not settings.telegram_bot_token:
        raise ValueError("TELEGRAM_BOT_TOKEN is not configured")
    app = Application.builder().token(settings.telegram_bot_token).build()
    app.add_handler(CommandHandler("start", start_handler))
    app.add_handler(CommandHandler("help", help_handler))
    app.add_handler(CommandHandler("link", link_handler))
    app.add_handler(CommandHandler("unlink", unlink_handler))
    app.add_handler(CommandHandler("me", me_handler))
    app.add_handler(CommandHandler("agents", agents_handler))
    app.add_handler(CommandHandler("new", new_handler))
    app.add_handler(CommandHandler("compress", compress_handler))
    app.add_handler(CommandHandler("status", status_handler))
    app.add_handler(CommandHandler("cancel", cancel_handler))
    app.add_handler(CallbackQueryHandler(agent_callback_handler, pattern=r"^set_agent:"))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, message_handler))
    return app


async def run_telegram_bot() -> None:
    """Start the Telegram bot inside an existing asyncio event loop (FastAPI lifespan)."""
    settings = _get_settings_fn()
    logger.info("Starting Telegram bot", mode=settings.telegram_mode)
    app = create_telegram_app()

    async with app:
        await app.start()
        commands = [
            BotCommand("start", "Welcome & setup instructions"),
            BotCommand("help", "List all commands"),
            BotCommand("link", "Link your Conflux account via API key"),
            BotCommand("unlink", "Unlink your Conflux account"),
            BotCommand("new", "Start a new conversation (clear history)"),
            BotCommand("compress", "Summarize and shrink the current chat"),
            BotCommand("me", "Show your linked account & active agent"),
            BotCommand("agents", "List and switch AI agents"),
            BotCommand("status", "Check Conflux system status"),
            BotCommand("cancel", "Cancel current operation"),
        ]
        await app.bot.set_my_commands(commands)
        if settings.telegram_mode == "polling":
            await app.updater.start_polling(drop_pending_updates=False)
        else:
            await app.updater.start_webhook(
                listen="0.0.0.0",
                port=8443,
                secret_token=settings.telegram_webhook_secret,
                webhook_url=f"{settings.public_base_url}/telegram/webhook",
            )
        logger.info("Telegram bot running")
        try:
            # Run until this coroutine is cancelled (e.g. on server shutdown)
            await asyncio.Event().wait()
        finally:
            await app.updater.stop()
            await app.stop()
