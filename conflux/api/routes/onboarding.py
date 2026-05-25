"""Onboarding wizard routes."""
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from conflux.api.auth import CurrentUser
from conflux.api.deps import DB
from conflux.models.agent import Agent, AgentRun
from conflux.models.provider import Provider
from conflux.models.user import User

router = APIRouter()


class OnboardingSteps(BaseModel):
    has_provider: bool
    has_agent: bool
    has_run: bool


class OnboardingStatus(BaseModel):
    completed: bool
    steps: OnboardingSteps


class OnboardingCompleteResponse(BaseModel):
    success: bool


async def _get_user_record(db: DB, user: CurrentUser) -> User:
    result = await db.execute(select(User).where(User.id == UUID(user.user_id)))
    current = result.scalar_one_or_none()
    if not current:
        raise HTTPException(404, 'User not found')
    return current


async def _has_rows(db: DB, stmt) -> bool:
    result = await db.execute(stmt.limit(1))
    return result.scalar_one_or_none() is not None


@router.get('/status', response_model=OnboardingStatus)
async def get_onboarding_status(db: DB, user: CurrentUser):
    current = await _get_user_record(db, user)
    has_provider = await _has_rows(
        db,
        select(Provider.id).where(Provider.is_enabled.is_(True)),
    )
    has_agent = await _has_rows(
        db,
        select(Agent.id).where(
            Agent.created_by == UUID(user.user_id),
            Agent.is_enabled.is_(True),
        ),
    )
    has_run = await _has_rows(
        db,
        select(AgentRun.id).where(AgentRun.user_id == UUID(user.user_id)),
    )
    return OnboardingStatus(
        completed=current.onboarding_completed,
        steps=OnboardingSteps(
            has_provider=has_provider,
            has_agent=has_agent,
            has_run=has_run,
        ),
    )


@router.post('/complete', response_model=OnboardingCompleteResponse)
async def complete_onboarding(db: DB, user: CurrentUser):
    current = await _get_user_record(db, user)
    current.onboarding_completed = True
    await db.flush()
    return OnboardingCompleteResponse(success=True)
