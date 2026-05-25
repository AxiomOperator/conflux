from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from conflux.models.wiki import WikiAccessRule, WikiGroupMember, WikiPage, WikiSpace


async def check_page_access(
    db: AsyncSession,
    page: WikiPage,
    user_id: UUID,
    is_admin: bool,
    permission: str = 'view',
    *,
    view_as_user: bool = False,
) -> bool:
    """Check access order: page-level rule → space-level rule → space default → deny."""
    if is_admin and not view_as_user:
        return True

    result = await db.execute(
        select(WikiGroupMember.group_id).where(WikiGroupMember.user_id == user_id)
    )
    group_ids = [row[0] for row in result.fetchall()]

    page_rules = await db.execute(
        select(WikiAccessRule).where(WikiAccessRule.page_id == page.id)
    )
    for rule in page_rules.scalars().all():
        if _rule_matches(rule, user_id, group_ids):
            return _has_permission(rule.permission, permission)

    space_rules = await db.execute(
        select(WikiAccessRule).where(
            WikiAccessRule.space_id == page.space_id,
            WikiAccessRule.page_id.is_(None),
        )
    )
    for rule in space_rules.scalars().all():
        if _rule_matches(rule, user_id, group_ids):
            return _has_permission(rule.permission, permission)

    space = await db.get(WikiSpace, page.space_id)
    if space and space.default_access == 'public':
        return permission == 'view'

    return False


async def check_space_access(
    db: AsyncSession,
    space: WikiSpace,
    user_id: UUID,
    is_admin: bool,
    permission: str = 'view',
    *,
    view_as_user: bool = False,
) -> bool:
    if is_admin and not view_as_user:
        return True

    result = await db.execute(
        select(WikiGroupMember.group_id).where(WikiGroupMember.user_id == user_id)
    )
    group_ids = [row[0] for row in result.fetchall()]

    space_rules = await db.execute(
        select(WikiAccessRule).where(
            WikiAccessRule.space_id == space.id,
            WikiAccessRule.page_id.is_(None),
        )
    )
    for rule in space_rules.scalars().all():
        if _rule_matches(rule, user_id, group_ids):
            return _has_permission(rule.permission, permission)

    if space.default_access == 'public':
        return permission == 'view'

    return False


def _rule_matches(rule: WikiAccessRule, user_id: UUID, group_ids: list[UUID]) -> bool:
    if rule.subject_type == 'everyone':
        return True
    if rule.subject_type == 'user' and rule.subject_id == user_id:
        return True
    if rule.subject_type == 'group' and rule.subject_id in group_ids:
        return True
    return False


def _has_permission(granted: str, required: str) -> bool:
    order = {'view': 0, 'edit': 1, 'admin': 2}
    return order.get(granted, 0) >= order.get(required, 0)
