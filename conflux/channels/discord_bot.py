"""Discord channel adapter.

Each incoming message or slash command is resolved to a Conflux user via the
DiscordLink table (established with /link <api_key>), then run through
AgentLoop directly — the same execution path used by /v1/runs/{run_id}/stream.

Guild-level configuration (DiscordGuildConfig) controls:
- Which Discord role is required to use the bot
- Which agent is assigned per channel
- Whether conversations open in threads or reply in-channel
- Where proactive notifications are posted
"""
from __future__ import annotations

import asyncio
import json
import re
import urllib.parse as _urlparse
from uuid import UUID, uuid4

import discord
from discord import app_commands
import structlog

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


_HISTORY_MAX = 40
_HISTORY_TTL = 604800  # 7 days

def _history_key(guild_id: int | str | None, channel_id: int | str, discord_user_id: int | str) -> str:
    if guild_id:
        return f"discord:history:{guild_id}:{channel_id}:{discord_user_id}"
    return f"discord:history:dm:{discord_user_id}"


async def _load_history(guild_id, channel_id, discord_user_id) -> list[dict]:
    redis = await _get_redis()
    key = _history_key(guild_id, channel_id, discord_user_id)
    raw = await redis.lrange(key, 0, -1)
    msgs = []
    for r in raw:
        try:
            msgs.append(json.loads(r))
        except Exception:
            pass
    return msgs


async def _save_to_history(guild_id, channel_id, discord_user_id, role: str, content: str) -> None:
    redis = await _get_redis()
    key = _history_key(guild_id, channel_id, discord_user_id)
    await redis.rpush(key, json.dumps({"role": role, "content": content}))
    await redis.ltrim(key, -_HISTORY_MAX, -1)
    await redis.expire(key, _HISTORY_TTL)


async def _clear_history(guild_id, channel_id, discord_user_id) -> None:
    redis = await _get_redis()
    key = _history_key(guild_id, channel_id, discord_user_id)
    await redis.delete(key)


_DISCORD_SYSTEM_SUFFIX = """
---
DISCORD CHANNEL INSTRUCTIONS (apply to this conversation only):
- Use standard markdown formatting that Discord supports: **bold**, *italic*, `code`, ```code blocks```, and - bullet lists.
- Keep responses concise and readable in a chat interface.
- Do NOT output raw HTML tags.
"""


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

async def _resolve_user(discord_user_id: int):
    """Return (Conflux User, Agent) for a Discord user, or (None, None)."""
    from sqlalchemy import select

    from conflux.core.database import get_db_session
    from conflux.models.agent import Agent
    from conflux.models.user import DiscordLink

    async with get_db_session() as db:
        link = await db.scalar(
            select(DiscordLink).where(DiscordLink.discord_user_id == discord_user_id)
        )
        if not link:
            return None, None

        from conflux.models.user import User
        user = await db.get(User, link.user_id)
        if not user or not user.is_active:
            return None, None

        agent = await db.scalar(
            select(Agent)
            .where(Agent.created_by == user.id, Agent.is_enabled.is_(True))
            .order_by(Agent.created_at.asc())
        )
        return user, agent


async def _resolve_agent_for_channel(guild_id: str, channel_id: str, user):
    """Return the Agent assigned to this channel, falling back to user's default."""
    from sqlalchemy import select

    from conflux.core.database import get_db_session
    from conflux.models.agent import Agent
    from conflux.models.discord_guild import DiscordGuildConfig

    async with get_db_session() as db:
        config = await db.scalar(
            select(DiscordGuildConfig).where(DiscordGuildConfig.guild_id == str(guild_id))
        )

        if config:
            channel_map = config.channel_agent_map or {}
            if str(channel_id) in channel_map:
                agent_id = channel_map[str(channel_id)]
                try:
                    agent = await db.get(Agent, UUID(agent_id))
                    if agent and agent.is_enabled:
                        return agent
                except Exception:
                    pass

            if config.default_agent_id:
                agent = await db.get(Agent, config.default_agent_id)
                if agent and agent.is_enabled:
                    return agent

        # Fall back to the user's own default agent
        agent = await db.scalar(
            select(Agent)
            .where(Agent.created_by == user.id, Agent.is_enabled.is_(True))
            .order_by(Agent.created_at.asc())
        )
        return agent


async def _get_guild_config(guild_id: str):
    """Return DiscordGuildConfig or None."""
    from sqlalchemy import select

    from conflux.core.database import get_db_session
    from conflux.models.discord_guild import DiscordGuildConfig

    async with get_db_session() as db:
        return await db.scalar(
            select(DiscordGuildConfig).where(DiscordGuildConfig.guild_id == str(guild_id))
        )


async def _upsert_guild_config(guild_id: str, guild_name: str, **kwargs):
    """Create or update a guild config."""
    from sqlalchemy import select

    from conflux.core.database import get_db_session
    from conflux.models.discord_guild import DiscordGuildConfig

    async with get_db_session() as db:
        config = await db.scalar(
            select(DiscordGuildConfig).where(DiscordGuildConfig.guild_id == str(guild_id))
        )
        if not config:
            config = DiscordGuildConfig(guild_id=str(guild_id), guild_name=guild_name)
            db.add(config)
        else:
            config.guild_name = guild_name
        for k, v in kwargs.items():
            setattr(config, k, v)
        await db.commit()
        await db.refresh(config)
        return config


async def _check_role_access(member: discord.Member, guild_id: str) -> bool:
    """Return True if the member has a role that is allowed to use the bot."""
    config = await _get_guild_config(guild_id)
    if not config or not config.allowed_role_ids:
        return True  # No restriction configured — allow everyone
    allowed = set(str(r) for r in config.allowed_role_ids)
    for role in member.roles:
        if str(role.id) in allowed:
            return True
    return False


# ---------------------------------------------------------------------------
# Agent loop runner
# ---------------------------------------------------------------------------

async def _run_agent_loop(
    user_id: str,
    tenant_id: str | None,
    agent,
    text: str,
    history: list[dict] | None = None,
) -> str:
    """Create a run record and execute AgentLoop, returning the final text."""
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

    base_prompt = agent.system_prompt or ""
    config = AgentConfig(
        agent_id=str(agent.id),
        name=agent.name,
        agent_type=agent.agent_type,
        system_prompt=base_prompt + _DISCORD_SYSTEM_SUFFIX,
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
# Discord embed helpers
# ---------------------------------------------------------------------------

CONFLUX_COLOR = discord.Color.from_rgb(99, 102, 241)  # Indigo — matches the UI brand
ERROR_COLOR = discord.Color.red()
SUCCESS_COLOR = discord.Color.green()
WARNING_COLOR = discord.Color.orange()


def _make_response_embed(content: str, agent_name: str, run_id: str | None = None) -> discord.Embed:
    """Wrap an agent response in a Discord embed, splitting if needed."""
    embed = discord.Embed(
        description=content[:4096],
        color=CONFLUX_COLOR,
    )
    embed.set_author(name=f"🤖 {agent_name}")
    if run_id:
        embed.set_footer(text=f"Run {run_id[:8]}…")
    return embed


def _make_error_embed(message: str) -> discord.Embed:
    return discord.Embed(description=f"❌ {message}", color=ERROR_COLOR)


def _make_thinking_embed() -> discord.Embed:
    return discord.Embed(description="⏳ Thinking…", color=discord.Color.light_grey())


async def _send_long_response(
    destination,
    content: str,
    agent_name: str,
    run_id: str | None = None,
    reference: discord.Message | None = None,
):
    """Send agent response, chunking if > 4096 chars. Returns first message sent."""
    chunks = [content[i : i + 4096] for i in range(0, len(content), 4096)]
    first_msg = None
    for idx, chunk in enumerate(chunks):
        embed = discord.Embed(description=chunk, color=CONFLUX_COLOR)
        if idx == 0:
            embed.set_author(name=f"🤖 {agent_name}")
        if idx == len(chunks) - 1 and run_id:
            embed.set_footer(text=f"Run {run_id[:8]}…")
        if reference and idx == 0:
            msg = await reference.reply(embed=embed)
        else:
            msg = await destination.send(embed=embed)
        if idx == 0:
            first_msg = msg
    return first_msg


# ---------------------------------------------------------------------------
# Audio transcription
# ---------------------------------------------------------------------------

async def _transcribe_attachment(attachment: discord.Attachment) -> str | None:
    """Download an audio attachment and transcribe via faster-whisper-server."""
    import httpx

    settings = _get_settings_fn()
    base_url = settings.whisper_base_url
    if not base_url:
        return None

    try:
        audio_data = await attachment.read()
        filename = attachment.filename or "audio.ogg"
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                f"{base_url.rstrip('/')}/inference",
                files={"file": (filename, audio_data, attachment.content_type or "audio/ogg")},
                data={"language": "en", "response_format": "json"},
            )
            resp.raise_for_status()
            result = resp.json()
            return result.get("text", "").strip()
    except Exception as e:
        logger.warning("Discord audio transcription failed", error=str(e))
        return None


_AUDIO_CONTENT_TYPES = {
    "audio/mpeg", "audio/ogg", "audio/wav", "audio/webm",
    "audio/mp4", "audio/aac", "audio/flac", "audio/x-m4a",
    "video/ogg",  # some clients send voice as video/ogg
}
_AUDIO_EXTENSIONS = {".mp3", ".ogg", ".wav", ".webm", ".m4a", ".aac", ".flac", ".opus"}


def _is_audio_attachment(attachment: discord.Attachment) -> bool:
    ct = (attachment.content_type or "").split(";")[0].strip().lower()
    if ct in _AUDIO_CONTENT_TYPES:
        return True
    ext = "." + attachment.filename.rsplit(".", 1)[-1].lower() if "." in attachment.filename else ""
    return ext in _AUDIO_EXTENSIONS


# ---------------------------------------------------------------------------
# Core message processing
# ---------------------------------------------------------------------------

async def _process_message(
    discord_user_id: int,
    discord_user: discord.User | discord.Member,
    guild: discord.Guild | None,
    channel,
    text: str,
    reply_to: discord.Message | None = None,
    thread_destination=None,
) -> None:
    """Resolve user + agent, run the loop, send the response."""
    guild_id = str(guild.id) if guild else None

    # Role check
    if guild and isinstance(discord_user, discord.Member):
        if not await _check_role_access(discord_user, guild_id):
            embed = _make_error_embed("You don't have the required role to use this bot on this server.")
            if reply_to:
                await reply_to.reply(embed=embed)
            else:
                await channel.send(embed=embed)
            return

    user, _ = await _resolve_user(discord_user_id)
    if not user:
        embed = discord.Embed(
            description=(
                "👋 Your Discord account isn't linked yet.\n\n"
                "Use `/link api_key:<your_key>` to connect your Conflux account.\n"
                "Generate an API key from the Conflux web UI under **Settings → API Keys**."
            ),
            color=WARNING_COLOR,
        )
        if reply_to:
            await reply_to.reply(embed=embed)
        else:
            await channel.send(embed=embed)
        return

    channel_id = str(channel.id)
    agent = await _resolve_agent_for_channel(guild_id or "dm", channel_id, user)
    if not agent:
        embed = _make_error_embed("No active agent found. Please configure an agent in Conflux.")
        if reply_to:
            await reply_to.reply(embed=embed)
        else:
            await channel.send(embed=embed)
        return

    # Show "thinking" indicator — reply to the triggering message if available
    dest = thread_destination or channel
    if reply_to:
        try:
            await reply_to.add_reaction("⏳")
        except Exception:
            pass
        thinking_msg = await reply_to.reply(embed=_make_thinking_embed())
    else:
        thinking_msg = await dest.send(embed=_make_thinking_embed())

    history = []
    try:
        history = await _load_history(guild_id, channel_id, discord_user_id)
    except Exception as e:
        logger.warning("Failed to load discord history", error=str(e))

    try:
        answer = await _run_agent_loop(
            user_id=str(user.id),
            tenant_id=str(user.personal_tenant_id) if user.personal_tenant_id else None,
            agent=agent,
            text=text,
            history=history,
        )
    except Exception as e:
        logger.error("Discord agent loop failed", error=str(e), discord_user_id=discord_user_id)
        if reply_to:
            try:
                await reply_to.remove_reaction("⏳", reply_to.guild.me if reply_to.guild else discord.Object(id=0))
                await reply_to.add_reaction("❌")
            except Exception:
                pass
        await thinking_msg.edit(embed=_make_error_embed("An error occurred. Please try again."))
        return

    try:
        await _save_to_history(guild_id, channel_id, discord_user_id, "user", text)
        await _save_to_history(guild_id, channel_id, discord_user_id, "assistant", answer)
    except Exception as e:
        logger.warning("Failed to save discord history", error=str(e))

    # Swap ⏳ → ✅ on the original message
    if reply_to:
        try:
            bot_user = reply_to.guild.me if reply_to.guild else None
            if bot_user:
                await reply_to.remove_reaction("⏳", bot_user)
            await reply_to.add_reaction("✅")
        except Exception:
            pass

    chunks = [answer[i : i + 4096] for i in range(0, len(answer), 4096)]
    for idx, chunk in enumerate(chunks):
        embed = discord.Embed(description=chunk, color=CONFLUX_COLOR)
        if idx == 0:
            embed.set_author(name=f"🤖 {agent.name}")
        if idx == len(chunks) - 1:
            embed.set_footer(text="Conflux AI")
        if idx == 0:
            await thinking_msg.edit(embed=embed)
        else:
            await dest.send(embed=embed)


# ---------------------------------------------------------------------------
# Bot client
# ---------------------------------------------------------------------------

class ConfluxBot(discord.Client):
    def __init__(self, members_intent: bool = True):
        intents = discord.Intents.default()
        intents.message_content = True  # Privileged — must be enabled in Developer Portal
        intents.guilds = True
        intents.members = members_intent  # Privileged — needed for role checks; enable in Developer Portal
        super().__init__(intents=intents)
        self.tree = app_commands.CommandTree(self)

    async def setup_hook(self):
        """Register all slash commands."""
        _register_commands(self.tree)
        # Sync globally (can take up to 1 hour to propagate; guild-specific syncs are instant)
        await self.tree.sync()
        logger.info("Discord slash commands synced")

    async def on_ready(self):
        logger.info("Discord bot ready", user=str(self.user), guilds=len(self.guilds))
        await self.change_presence(
            activity=discord.Activity(type=discord.ActivityType.watching, name="for @mentions")
        )

    async def on_guild_join(self, guild: discord.Guild):
        """Auto-register guild when bot is added to a new server."""
        await _upsert_guild_config(str(guild.id), guild.name)
        logger.info("Discord bot joined guild", guild_id=guild.id, guild_name=guild.name)

    async def on_message(self, message: discord.Message):
        if message.author.bot:
            return

        is_dm = isinstance(message.channel, discord.DMChannel)
        bot_mentioned = self.user in (message.mentions or [])

        # Handle audio attachments in DMs and @mention contexts
        if message.attachments:
            audio_atts = [a for a in message.attachments if _is_audio_attachment(a)]
            if audio_atts and (is_dm or bot_mentioned):
                async with message.channel.typing():
                    transcription = await _transcribe_attachment(audio_atts[0])
                if transcription:
                    text = transcription
                    if len(message.attachments) > 1 or message.content.strip():
                        extra = message.content.replace(f"<@{self.user.id}>", "").strip()
                        if extra:
                            text = f"{extra}\n\n[Voice transcription: {transcription}]"
                    await _process_message(
                        discord_user_id=message.author.id,
                        discord_user=message.author,
                        guild=message.guild,
                        channel=message.channel,
                        text=text,
                        reply_to=message,
                        thread_destination=await _get_thread_dest(message),
                    )
                else:
                    await message.reply(embed=_make_error_embed("Could not transcribe the audio. Is faster-whisper running?"))
                return

        # DMs: respond to all messages
        if is_dm:
            text = message.content.strip()
            if text:
                await _process_message(
                    discord_user_id=message.author.id,
                    discord_user=message.author,
                    guild=None,
                    channel=message.channel,
                    text=text,
                    reply_to=message,
                )
            return

        # Guild channels: only respond to @mentions
        if not bot_mentioned:
            return

        text = re.sub(r"<@!?\d+>", "", message.content).strip()
        if not text:
            await message.reply(embed=discord.Embed(description="How can I help you? Just ask!", color=CONFLUX_COLOR))
            return

        guild_id = str(message.guild.id)
        config = await _get_guild_config(guild_id)
        thread_dest = None

        if config and config.thread_mode:
            thread_dest = await _get_or_create_thread(message)

        await _process_message(
            discord_user_id=message.author.id,
            discord_user=message.author,
            guild=message.guild,
            channel=message.channel,
            text=text,
            reply_to=message,
            thread_destination=thread_dest,
        )


async def _get_thread_dest(message: discord.Message):
    """If the message is already in a thread, return None (use it as-is)."""
    if isinstance(message.channel, discord.Thread):
        return message.channel
    return None


async def _get_or_create_thread(message: discord.Message):
    """Create a thread for this conversation, or reuse existing thread."""
    if isinstance(message.channel, discord.Thread):
        return message.channel
    try:
        short_content = re.sub(r"<@!?\d+>", "", message.content).strip()[:50] or "Conversation"
        thread = await message.create_thread(
            name=f"💬 {short_content}",
            auto_archive_duration=60,
        )
        return thread
    except discord.Forbidden:
        return None  # No permission to create threads — fall back to channel
    except Exception as e:
        logger.warning("Failed to create Discord thread", error=str(e))
        return None


# ---------------------------------------------------------------------------
# Slash commands
# ---------------------------------------------------------------------------

def _register_commands(tree: app_commands.CommandTree):
    """Register all slash commands onto the command tree."""

    @tree.command(name="ask", description="Send a message to your Conflux agent")
    @app_commands.describe(message="The message to send to your agent")
    async def ask_cmd(interaction: discord.Interaction, message: str):
        await interaction.response.defer(thinking=True)
        guild_id = str(interaction.guild_id) if interaction.guild_id else None
        channel_id = str(interaction.channel_id)

        user, _ = await _resolve_user(interaction.user.id)
        if not user:
            await interaction.followup.send(embed=discord.Embed(
                description="👋 Link your account first: `/link api_key:<your_key>`",
                color=WARNING_COLOR,
            ))
            return

        if interaction.guild and isinstance(interaction.user, discord.Member):
            if not await _check_role_access(interaction.user, str(interaction.guild_id)):
                await interaction.followup.send(embed=_make_error_embed("You don't have the required role."), ephemeral=True)
                return

        agent = await _resolve_agent_for_channel(guild_id or "dm", channel_id, user)
        if not agent:
            await interaction.followup.send(embed=_make_error_embed("No active agent found."), ephemeral=True)
            return

        history = []
        try:
            history = await _load_history(guild_id, channel_id, interaction.user.id)
        except Exception:
            pass

        try:
            answer = await _run_agent_loop(
                user_id=str(user.id),
                tenant_id=str(user.personal_tenant_id) if user.personal_tenant_id else None,
                agent=agent,
                text=message,
                history=history,
            )
        except Exception as e:
            logger.error("Discord /ask agent loop failed", error=str(e))
            await interaction.followup.send(embed=_make_error_embed("An error occurred."), ephemeral=True)
            return

        try:
            await _save_to_history(guild_id, channel_id, interaction.user.id, "user", message)
            await _save_to_history(guild_id, channel_id, interaction.user.id, "assistant", answer)
        except Exception:
            pass

        chunks = [answer[i : i + 4096] for i in range(0, len(answer), 4096)]
        for idx, chunk in enumerate(chunks):
            embed = discord.Embed(description=chunk, color=CONFLUX_COLOR)
            if idx == 0:
                embed.set_author(name=f"🤖 {agent.name}")
            if idx == len(chunks) - 1:
                embed.set_footer(text="Conflux AI")
            if idx == 0:
                await interaction.followup.send(embed=embed)
            else:
                await interaction.channel.send(embed=embed)

    @tree.command(name="link", description="Link your Discord account to your Conflux account")
    @app_commands.describe(api_key="Your Conflux API key (from Settings → API Keys)")
    async def link_cmd(interaction: discord.Interaction, api_key: str):
        await interaction.response.defer(ephemeral=True)
        import hashlib
        from sqlalchemy import select

        from conflux.core.database import get_db_session
        from conflux.models.user import APIKey, DiscordLink, User

        settings = _get_settings_fn()
        key_hash = hashlib.sha256(f"{settings.api_key_pepper}{api_key}".encode()).hexdigest()

        async with get_db_session() as db:
            row = await db.execute(
                select(APIKey, User)
                .join(User, APIKey.user_id == User.id)
                .where(APIKey.key_hash == key_hash, APIKey.is_active.is_(True), User.is_active.is_(True))
            )
            result = row.first()
            if not result:
                await interaction.followup.send(
                    embed=_make_error_embed("Invalid or inactive API key. Generate one from the Conflux web UI under Settings → API Keys."),
                    ephemeral=True,
                )
                return
            key_obj, _user = result

            existing = await db.scalar(
                select(DiscordLink).where(DiscordLink.discord_user_id == interaction.user.id)
            )
            if existing:
                if existing.user_id == key_obj.user_id:
                    await interaction.followup.send(
                        embed=discord.Embed(description="✅ Already linked to this account.", color=SUCCESS_COLOR),
                        ephemeral=True,
                    )
                    return
                existing.user_id = key_obj.user_id
                existing.linked_via_key_id = key_obj.id
            else:
                link = DiscordLink(
                    discord_user_id=interaction.user.id,
                    user_id=key_obj.user_id,
                    linked_via_key_id=key_obj.id,
                )
                db.add(link)
            await db.commit()

        await interaction.followup.send(
            embed=discord.Embed(
                description="✅ Account linked! You can now chat with your Conflux agent here.",
                color=SUCCESS_COLOR,
            ),
            ephemeral=True,
        )

    @tree.command(name="unlink", description="Unlink your Discord account from Conflux")
    async def unlink_cmd(interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        from sqlalchemy import delete

        from conflux.core.database import get_db_session
        from conflux.models.user import DiscordLink

        async with get_db_session() as db:
            result = await db.execute(
                delete(DiscordLink).where(DiscordLink.discord_user_id == interaction.user.id)
            )
            await db.commit()
            if result.rowcount:
                await interaction.followup.send(
                    embed=discord.Embed(description="✅ Account unlinked.", color=SUCCESS_COLOR),
                    ephemeral=True,
                )
            else:
                await interaction.followup.send(
                    embed=discord.Embed(description="No linked account found.", color=WARNING_COLOR),
                    ephemeral=True,
                )

    @tree.command(name="new", description="Start a fresh conversation (clears history)")
    async def new_cmd(interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        guild_id = str(interaction.guild_id) if interaction.guild_id else None
        await _clear_history(guild_id, str(interaction.channel_id), interaction.user.id)
        await interaction.followup.send(
            embed=discord.Embed(description="🆕 Conversation history cleared. Fresh start!", color=SUCCESS_COLOR),
            ephemeral=True,
        )

    @tree.command(name="me", description="Show your linked Conflux account and active agent")
    async def me_cmd(interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        user, agent = await _resolve_user(interaction.user.id)
        if not user:
            await interaction.followup.send(
                embed=discord.Embed(
                    description="No linked account found. Use `/link api_key:<key>` to connect.",
                    color=WARNING_COLOR,
                ),
                ephemeral=True,
            )
            return
        embed = discord.Embed(title="Your Conflux Account", color=CONFLUX_COLOR)
        embed.add_field(name="Email", value=user.email, inline=False)
        embed.add_field(name="Display Name", value=user.display_name, inline=True)
        embed.add_field(name="Active Agent", value=agent.name if agent else "None", inline=True)
        await interaction.followup.send(embed=embed, ephemeral=True)

    @tree.command(name="agents", description="List available agents")
    async def agents_cmd(interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        user, _ = await _resolve_user(interaction.user.id)
        if not user:
            await interaction.followup.send(
                embed=discord.Embed(description="Link your account first with `/link`.", color=WARNING_COLOR),
                ephemeral=True,
            )
            return

        from sqlalchemy import select

        from conflux.core.database import get_db_session
        from conflux.models.agent import Agent

        async with get_db_session() as db:
            agents = (
                await db.scalars(
                    select(Agent)
                    .where(Agent.created_by == user.id, Agent.is_enabled.is_(True))
                    .order_by(Agent.name)
                )
            ).all()

        if not agents:
            await interaction.followup.send(
                embed=discord.Embed(description="No active agents found.", color=WARNING_COLOR),
                ephemeral=True,
            )
            return

        embed = discord.Embed(title="Your Conflux Agents", color=CONFLUX_COLOR)
        for ag in agents[:25]:
            value = ag.description or ag.agent_type or "—"
            embed.add_field(name=ag.name, value=value[:100], inline=False)
        await interaction.followup.send(embed=embed, ephemeral=True)

    @tree.command(name="status", description="Check Conflux bot and server status")
    async def status_cmd(interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        user, agent = await _resolve_user(interaction.user.id)
        guild_config = None
        if interaction.guild_id:
            guild_config = await _get_guild_config(str(interaction.guild_id))

        embed = discord.Embed(title="Conflux Status", color=SUCCESS_COLOR)
        embed.add_field(
            name="Account",
            value=f"✅ Linked ({user.email})" if user else "❌ Not linked",
            inline=False,
        )
        embed.add_field(
            name="Agent",
            value=f"✅ {agent.name}" if agent else "❌ None configured",
            inline=True,
        )
        if guild_config:
            embed.add_field(
                name="Thread Mode",
                value="✅ On" if guild_config.thread_mode else "❌ Off",
                inline=True,
            )
            role_count = len(guild_config.allowed_role_ids or [])
            embed.add_field(
                name="Allowed Roles",
                value=f"{role_count} configured" if role_count else "All members",
                inline=True,
            )
            if guild_config.notification_channel_id:
                embed.add_field(
                    name="Notifications",
                    value=f"<#{guild_config.notification_channel_id}>",
                    inline=True,
                )
        await interaction.followup.send(embed=embed, ephemeral=True)

    # ── Admin command group ──────────────────────────────────────────────────
    config_group = app_commands.Group(
        name="config",
        description="Configure the Conflux bot for this server (admin only)",
    )

    async def _require_admin(interaction: discord.Interaction) -> bool:
        if not interaction.guild:
            await interaction.followup.send(embed=_make_error_embed("This command only works in a server."), ephemeral=True)
            return False
        if not interaction.user.guild_permissions.administrator:
            await interaction.followup.send(embed=_make_error_embed("You must be a server administrator to use this command."), ephemeral=True)
            return False
        return True

    @config_group.command(name="set-role", description="Set the Discord role required to use the bot")
    @app_commands.describe(role="The role members must have to use the bot (leave empty to allow all)")
    async def config_setrole(interaction: discord.Interaction, role: discord.Role | None = None):
        await interaction.response.defer(ephemeral=True)
        if not await _require_admin(interaction):
            return
        role_ids = [str(role.id)] if role else []
        await _upsert_guild_config(str(interaction.guild_id), interaction.guild.name, allowed_role_ids=role_ids)
        msg = f"✅ Bot access restricted to **{role.name}**." if role else "✅ Bot access opened to all server members."
        await interaction.followup.send(embed=discord.Embed(description=msg, color=SUCCESS_COLOR), ephemeral=True)

    @config_group.command(name="set-agent", description="Assign an agent to a channel")
    @app_commands.describe(channel="The channel to configure", agent_name="Name of the Conflux agent to assign")
    async def config_setagent(interaction: discord.Interaction, channel: discord.TextChannel, agent_name: str):
        await interaction.response.defer(ephemeral=True)
        if not await _require_admin(interaction):
            return

        from sqlalchemy import select

        from conflux.core.database import get_db_session
        from conflux.models.agent import Agent

        async with get_db_session() as db:
            agent = await db.scalar(
                select(Agent).where(Agent.name.ilike(agent_name), Agent.is_enabled.is_(True))
            )
            if not agent:
                await interaction.followup.send(embed=_make_error_embed(f"No active agent named '{agent_name}' found."), ephemeral=True)
                return

        config = await _get_guild_config(str(interaction.guild_id))
        existing_map = (config.channel_agent_map or {}) if config else {}
        existing_map[str(channel.id)] = str(agent.id)
        await _upsert_guild_config(str(interaction.guild_id), interaction.guild.name, channel_agent_map=existing_map)
        await interaction.followup.send(
            embed=discord.Embed(description=f"✅ {channel.mention} → **{agent.name}**", color=SUCCESS_COLOR),
            ephemeral=True,
        )

    @config_group.command(name="set-notify", description="Set the channel for proactive notifications")
    @app_commands.describe(channel="The channel to send notifications to")
    async def config_setnotify(interaction: discord.Interaction, channel: discord.TextChannel):
        await interaction.response.defer(ephemeral=True)
        if not await _require_admin(interaction):
            return
        await _upsert_guild_config(str(interaction.guild_id), interaction.guild.name, notification_channel_id=str(channel.id))
        await interaction.followup.send(
            embed=discord.Embed(description=f"✅ Notifications will be posted to {channel.mention}.", color=SUCCESS_COLOR),
            ephemeral=True,
        )

    @config_group.command(name="thread-mode", description="Toggle thread-per-conversation mode")
    @app_commands.describe(enabled="Enable (on) or disable (off) thread mode")
    @app_commands.choices(enabled=[
        app_commands.Choice(name="on", value="on"),
        app_commands.Choice(name="off", value="off"),
    ])
    async def config_threadmode(interaction: discord.Interaction, enabled: app_commands.Choice[str]):
        await interaction.response.defer(ephemeral=True)
        if not await _require_admin(interaction):
            return
        on = enabled.value == "on"
        await _upsert_guild_config(str(interaction.guild_id), interaction.guild.name, thread_mode=on)
        msg = "✅ Thread mode **enabled** — each conversation will create a new thread." if on else "✅ Thread mode **disabled** — bot replies in the same channel."
        await interaction.followup.send(embed=discord.Embed(description=msg, color=SUCCESS_COLOR), ephemeral=True)

    @config_group.command(name="status", description="Show current bot configuration for this server")
    async def config_status(interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        if not await _require_admin(interaction):
            return
        config = await _get_guild_config(str(interaction.guild_id))
        if not config:
            await interaction.followup.send(
                embed=discord.Embed(description="No configuration yet. Use `/config set-role`, `/config set-agent`, etc.", color=WARNING_COLOR),
                ephemeral=True,
            )
            return

        embed = discord.Embed(title=f"Bot Config: {interaction.guild.name}", color=CONFLUX_COLOR)
        role_ids = config.allowed_role_ids or []
        if role_ids:
            roles_str = ", ".join(f"<@&{r}>" for r in role_ids)
        else:
            roles_str = "All members"
        embed.add_field(name="Allowed Roles", value=roles_str, inline=False)
        embed.add_field(name="Thread Mode", value="✅ On" if config.thread_mode else "❌ Off", inline=True)
        if config.notification_channel_id:
            embed.add_field(name="Notifications", value=f"<#{config.notification_channel_id}>", inline=True)

        ch_map = config.channel_agent_map or {}
        if ch_map:
            from sqlalchemy import select
            from conflux.core.database import get_db_session
            from conflux.models.agent import Agent

            lines = []
            async with get_db_session() as db:
                for ch_id, ag_id in list(ch_map.items())[:10]:
                    try:
                        ag = await db.get(Agent, UUID(ag_id))
                        lines.append(f"<#{ch_id}> → {ag.name if ag else ag_id[:8]}")
                    except Exception:
                        lines.append(f"<#{ch_id}> → {ag_id[:8]}")
            embed.add_field(name="Channel → Agent", value="\n".join(lines), inline=False)

        await interaction.followup.send(embed=embed, ephemeral=True)

    tree.add_command(config_group)


# ---------------------------------------------------------------------------
# Notification helper (called by scheduler / run completion hooks)
# ---------------------------------------------------------------------------

async def send_notification(guild_id: str, content: str, title: str = "Conflux Notification") -> bool:
    """Post a notification embed to a guild's configured notification channel.

    Returns True if the message was sent, False otherwise.
    Must be called from within the bot's event loop.
    """
    global _bot_instance
    if not _bot_instance:
        return False

    config = await _get_guild_config(guild_id)
    if not config or not config.notification_channel_id:
        return False

    channel = _bot_instance.get_channel(int(config.notification_channel_id))
    if not channel:
        return False

    embed = discord.Embed(title=title, description=content[:4096], color=CONFLUX_COLOR)
    embed.set_footer(text="Conflux AI")
    try:
        await channel.send(embed=embed)
        return True
    except Exception as e:
        logger.warning("Failed to send Discord notification", error=str(e), guild_id=guild_id)
        return False


_bot_instance: ConfluxBot | None = None


# ---------------------------------------------------------------------------
# Bot runner
# ---------------------------------------------------------------------------

async def run_discord_bot() -> None:
    """Start the Discord bot inside an existing asyncio event loop (FastAPI lifespan)."""
    global _bot_instance

    # Prefer DB-stored token over env var
    from conflux.core.database import get_session_factory
    from conflux.services.system_settings import get_setting
    _sf = get_session_factory()
    async with _sf() as _db:
        token = await get_setting(_db, "discord_bot_token") or _get_settings_fn().discord_bot_token

    if not token:
        logger.warning("Discord bot token not configured — bot will not start")
        return

    bot = ConfluxBot()
    _bot_instance = bot

    try:
        logger.info("Starting Discord bot")
        await bot.start(token)
    except discord.LoginFailure:
        logger.error("Discord bot login failed — check discord_bot_token setting")
        _bot_instance = None
    except asyncio.CancelledError:
        logger.info("Discord bot task cancelled — shutting down")
        await bot.close()
        _bot_instance = None
    except discord.PrivilegedIntentsRequired:
        await bot.close()
        logger.warning(
            "Discord bot: privileged intents not enabled. "
            "Retrying without Members intent (role-based access control disabled)…"
        )
        # Retry without Members intent — bot works but role checks are skipped
        fallback_bot = ConfluxBot(members_intent=False)
        _bot_instance = fallback_bot
        try:
            await fallback_bot.start(token)
        except discord.PrivilegedIntentsRequired:
            await fallback_bot.close()
            _bot_instance = None
            logger.error(
                "Discord bot cannot start: Message Content Intent is not enabled. "
                "ACTION REQUIRED: Go to https://discord.com/developers/applications → "
                "Bot → Privileged Gateway Intents and enable BOTH:\n"
                "  • Server Members Intent\n"
                "  • Message Content Intent\n"
                "Then restart the Conflux API container."
            )
        except asyncio.CancelledError:
            logger.info("Discord bot task cancelled — shutting down")
            await fallback_bot.close()
            _bot_instance = None
        except Exception as e2:
            logger.error("Discord bot fallback failed", error=str(e2))
            _bot_instance = None
    except Exception as e:
        logger.error("Discord bot crashed", error=str(e))
        _bot_instance = None
