"""SkillsMP marketplace client."""
from __future__ import annotations

import re

import aiohttp
import structlog

from conflux.core.config import get_settings

logger = structlog.get_logger(__name__)


def _github_url_to_raw(github_url: str) -> str | None:
    """Convert a GitHub tree URL to a raw SKILL.md URL.

    Input:  https://github.com/owner/repo/tree/branch/path/to/skill
    Output: https://raw.githubusercontent.com/owner/repo/branch/path/to/skill/SKILL.md
    """
    pattern = r"https://github\.com/([^/]+)/([^/]+)/tree/([^/]+)/(.*)"
    m = re.match(pattern, github_url.rstrip("/"))
    if not m:
        return None
    owner, repo, branch, path = m.groups()
    return f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}/SKILL.md"


async def search_marketplace(
    query: str,
    *,
    page: int = 1,
    limit: int = 20,
    sort_by: str | None = None,
    category: str | None = None,
    occupation: str | None = None,
) -> dict:
    """Search SkillsMP for skills matching the query."""
    settings = get_settings()
    params: dict = {"q": query, "page": page, "limit": min(limit, 100)}
    if sort_by:
        params["sortBy"] = sort_by
    if category:
        params["category"] = category
    if occupation:
        params["occupation"] = occupation

    headers = {}
    if settings.skills_api_key:
        headers["X-API-Key"] = settings.skills_api_key

    timeout = aiohttp.ClientTimeout(total=10)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(
            f"{settings.skillsmp_base_url}/skills/search",
            params=params,
            headers=headers,
        ) as resp:
            resp.raise_for_status()
            data = await resp.json()

    skills = data.get("data", {}).get("skills", [])
    pagination = data.get("data", {}).get("pagination", {})
    logger.info("SkillsMP search", query=query, results=len(skills))
    return {"skills": skills, "pagination": pagination}


async def fetch_skill_content(github_url: str) -> str | None:
    """Fetch the raw SKILL.md content for a marketplace skill via GitHub."""
    raw_url = _github_url_to_raw(github_url)
    if not raw_url:
        logger.warning("Could not convert GitHub URL to raw", url=github_url)
        return None

    timeout = aiohttp.ClientTimeout(total=10)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(raw_url) as resp:
            if resp.status == 404:
                fallback = raw_url.replace("/SKILL.md", "/README.md")
                async with session.get(fallback) as r2:
                    if r2.status == 200:
                        return await r2.text()
                return None
            resp.raise_for_status()
            return await resp.text()
