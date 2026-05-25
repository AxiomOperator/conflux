from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal
from uuid import UUID

import structlog
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from conflux.api.auth import AdminUser
from conflux.core.config import get_settings
from conflux.core.database import get_db_session
from conflux.models.learning import EvalCase, EvolutionCandidate, ImprovementPattern, SkillEvalRecord
from conflux.models.skill import Skill, SkillVersion

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/improvement")


class ImprovementPatternOut(BaseModel):
    id: UUID
    detected_at: datetime
    pattern_type: str
    skill_id: UUID | None
    frequency: int
    severity: float | None
    is_systemic: bool
    description: str
    example_run_ids: list[Any] = Field(default_factory=list)
    evidence: dict[str, Any] = Field(default_factory=dict)
    status: str

    model_config = ConfigDict(from_attributes=True)


class ImprovementPatternPage(BaseModel):
    items: list[ImprovementPatternOut]
    total: int
    page: int
    page_size: int


class ImprovementPatternStatusUpdate(BaseModel):
    status: Literal["acknowledged", "resolved", "ignored"]


class EvolutionCandidateOut(BaseModel):
    id: UUID
    created_at: datetime
    updated_at: datetime
    skill_id: UUID | None
    candidate_type: str
    current_content: str
    proposed_content: str
    rationale: str | None
    eval_score: float | None
    eval_dataset: dict[str, Any] | None = None
    approval_status: str
    approved_by: UUID | None
    approved_at: datetime | None
    decision: str | None
    decision_reason: str | None
    comparison_scores: dict[str, Any] | None = None
    test_results: dict[str, Any] | None = None
    detected_pattern: str | None
    pattern_id: UUID | None

    model_config = ConfigDict(from_attributes=True)


class EvolutionCandidatePage(BaseModel):
    items: list[EvolutionCandidateOut]
    total: int
    page: int
    page_size: int


class EvolutionCandidateDecisionInput(BaseModel):
    decision: Literal["promote", "reject", "quarantine"]
    reason: str | None = None


class EvalCaseOut(BaseModel):
    id: UUID
    created_at: datetime
    skill_id: UUID | None
    case_type: str
    description: str
    input_context: dict[str, Any] = Field(default_factory=dict)
    expected_behavior: str
    acceptance_criteria: str | None
    source: str
    source_run_id: UUID | None
    is_active: bool
    tags: list[Any] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class EvalCasePage(BaseModel):
    items: list[EvalCaseOut]
    total: int
    page: int
    page_size: int


class EvalCaseCreateInput(BaseModel):
    skill_id: UUID | None
    case_type: str
    description: str
    input_context: dict[str, Any]
    expected_behavior: str
    acceptance_criteria: str | None = None
    tags: list[Any] = Field(default_factory=list)


class EvalCaseUpdateInput(BaseModel):
    is_active: bool | None = None
    expected_behavior: str | None = None
    acceptance_criteria: str | None = None


class SkillEvalRecordOut(BaseModel):
    id: UUID
    created_at: datetime
    run_id: UUID
    skill_id: UUID
    skill_version: int | None
    task_context: str | None
    selection_reason: str | None
    expected_benefit: str | None
    dimensions_improved: list[Any] = Field(default_factory=list)
    negative_effects: str | None
    counterfactual_worse: bool | None
    evidence_strength: float | None
    did_improve: bool | None
    improvement_detail: str | None
    recommendation: str
    eval_notes: str | None

    model_config = ConfigDict(from_attributes=True)


class SkillEvalRecordPage(BaseModel):
    items: list[SkillEvalRecordOut]
    total: int
    page: int
    page_size: int


class DeleteResponse(BaseModel):
    deleted: bool


class QueueResponse(BaseModel):
    status: str
    message: str


async def _get_pattern_or_404(db: AsyncSession, pattern_id: UUID) -> ImprovementPattern:
    result = await db.execute(select(ImprovementPattern).where(ImprovementPattern.id == pattern_id))
    pattern = result.scalar_one_or_none()
    if pattern is None:
        raise HTTPException(status_code=404, detail="Improvement pattern not found")
    return pattern


async def _get_candidate_or_404(db: AsyncSession, candidate_id: UUID) -> EvolutionCandidate:
    result = await db.execute(select(EvolutionCandidate).where(EvolutionCandidate.id == candidate_id))
    candidate = result.scalar_one_or_none()
    if candidate is None:
        raise HTTPException(status_code=404, detail="Evolution candidate not found")
    return candidate


async def _get_eval_case_or_404(db: AsyncSession, case_id: UUID) -> EvalCase:
    result = await db.execute(select(EvalCase).where(EvalCase.id == case_id))
    eval_case = result.scalar_one_or_none()
    if eval_case is None:
        raise HTTPException(status_code=404, detail="Eval case not found")
    return eval_case


async def _get_skill_eval_or_404(db: AsyncSession, eval_id: UUID) -> SkillEvalRecord:
    result = await db.execute(select(SkillEvalRecord).where(SkillEvalRecord.id == eval_id))
    eval_record = result.scalar_one_or_none()
    if eval_record is None:
        raise HTTPException(status_code=404, detail="Skill eval record not found")
    return eval_record


async def _get_skill_or_404(db: AsyncSession, skill_id: UUID) -> Skill:
    result = await db.execute(select(Skill).where(Skill.id == skill_id))
    skill = result.scalar_one_or_none()
    if skill is None:
        raise HTTPException(status_code=404, detail="Skill not found")
    return skill


@router.get("/patterns", response_model=ImprovementPatternPage)
async def list_patterns(
    user: AdminUser,
    status: str | None = Query(None),
    pattern_type: str | None = Query(None),
    skill_id: UUID | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
) -> ImprovementPatternPage:
    del user

    async with get_db_session() as db:
        query = select(ImprovementPattern)
        if status:
            query = query.where(ImprovementPattern.status == status)
        if pattern_type:
            query = query.where(ImprovementPattern.pattern_type == pattern_type)
        if skill_id:
            query = query.where(ImprovementPattern.skill_id == skill_id)

        total_result = await db.execute(select(func.count()).select_from(query.subquery()))
        total = total_result.scalar_one()

        result = await db.execute(
            query
            .order_by(ImprovementPattern.detected_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        items = list(result.scalars().all())

    return ImprovementPatternPage(items=items, total=total, page=page, page_size=page_size)


@router.get("/patterns/{pattern_id}", response_model=ImprovementPatternOut)
async def get_pattern(pattern_id: UUID, user: AdminUser) -> ImprovementPatternOut:
    del user

    async with get_db_session() as db:
        return await _get_pattern_or_404(db, pattern_id)


@router.patch("/patterns/{pattern_id}/status", response_model=ImprovementPatternOut)
async def update_pattern_status(
    pattern_id: UUID,
    body: ImprovementPatternStatusUpdate,
    user: AdminUser,
) -> ImprovementPatternOut:
    async with get_db_session() as db:
        pattern = await _get_pattern_or_404(db, pattern_id)
        pattern.status = body.status
        await db.flush()
        logger.info(
            "Improvement pattern status updated",
            pattern_id=str(pattern.id),
            status=pattern.status,
            user_id=user.user_id,
        )
        return pattern


@router.get("/candidates", response_model=EvolutionCandidatePage)
async def list_candidates(
    user: AdminUser,
    decision: str | None = Query(None),
    approval_status: str | None = Query(None),
    skill_id: UUID | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
) -> EvolutionCandidatePage:
    del user

    async with get_db_session() as db:
        query = select(EvolutionCandidate)
        if decision:
            query = query.where(EvolutionCandidate.decision == decision)
        if approval_status:
            query = query.where(EvolutionCandidate.approval_status == approval_status)
        if skill_id:
            query = query.where(EvolutionCandidate.skill_id == skill_id)

        total_result = await db.execute(select(func.count()).select_from(query.subquery()))
        total = total_result.scalar_one()

        result = await db.execute(
            query
            .order_by(EvolutionCandidate.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        items = list(result.scalars().all())

    return EvolutionCandidatePage(items=items, total=total, page=page, page_size=page_size)


@router.get("/candidates/{candidate_id}", response_model=EvolutionCandidateOut)
async def get_candidate(candidate_id: UUID, user: AdminUser) -> EvolutionCandidateOut:
    del user

    async with get_db_session() as db:
        return await _get_candidate_or_404(db, candidate_id)


@router.post("/candidates/{candidate_id}/decide", response_model=EvolutionCandidateOut)
async def decide_candidate(
    candidate_id: UUID,
    body: EvolutionCandidateDecisionInput,
    user: AdminUser,
) -> EvolutionCandidateOut:
    async with get_db_session() as db:
        candidate = await _get_candidate_or_404(db, candidate_id)
        now = datetime.now(timezone.utc)
        reason = body.reason.strip() if body.reason else None

        if body.decision == "promote":
            if candidate.skill_id is not None:
                skill = await _get_skill_or_404(db, candidate.skill_id)
                version_result = await db.execute(
                    select(func.max(SkillVersion.version)).where(SkillVersion.skill_id == skill.id)
                )
                max_version = version_result.scalar() or 0

                new_version = SkillVersion(
                    skill_id=skill.id,
                    version=max_version + 1,
                    content=candidate.proposed_content,
                    change_summary=reason or f"Evolution candidate promoted by {user.email}",
                    promoted_by=UUID(user.user_id),
                    promoted_at=now,
                )
                db.add(new_version)
                await db.flush()

                skill.active_version_id = new_version.id
                skill.approval_status = "approved"

            candidate.approval_status = "approved"
            candidate.approved_by = UUID(user.user_id)
            candidate.approved_at = now
        elif body.decision == "reject":
            candidate.approval_status = "rejected"
            candidate.approved_by = UUID(user.user_id)
            candidate.approved_at = now
        else:
            candidate.approval_status = "pending"
            candidate.approved_by = None
            candidate.approved_at = None

        candidate.decision = body.decision
        candidate.decision_reason = reason
        await db.flush()

        logger.info(
            "Evolution candidate decision updated",
            candidate_id=str(candidate.id),
            decision=candidate.decision,
            approval_status=candidate.approval_status,
            user_id=user.user_id,
        )
        return candidate


@router.get("/eval-cases", response_model=EvalCasePage)
async def list_eval_cases(
    user: AdminUser,
    skill_id: UUID | None = Query(None),
    case_type: str | None = Query(None),
    is_active: bool | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
) -> EvalCasePage:
    del user

    async with get_db_session() as db:
        query = select(EvalCase)
        if skill_id:
            query = query.where(EvalCase.skill_id == skill_id)
        if case_type:
            query = query.where(EvalCase.case_type == case_type)
        if is_active is not None:
            query = query.where(EvalCase.is_active == is_active)

        total_result = await db.execute(select(func.count()).select_from(query.subquery()))
        total = total_result.scalar_one()

        result = await db.execute(
            query
            .order_by(EvalCase.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        items = list(result.scalars().all())

    return EvalCasePage(items=items, total=total, page=page, page_size=page_size)


@router.post("/eval-cases", response_model=EvalCaseOut, status_code=201)
async def create_eval_case(body: EvalCaseCreateInput, user: AdminUser) -> EvalCaseOut:
    async with get_db_session() as db:
        if body.skill_id is not None:
            await _get_skill_or_404(db, body.skill_id)

        eval_case = EvalCase(
            skill_id=body.skill_id,
            case_type=body.case_type,
            description=body.description,
            input_context=body.input_context,
            expected_behavior=body.expected_behavior,
            acceptance_criteria=body.acceptance_criteria,
            source="manual",
            is_active=True,
            tags=body.tags,
        )
        db.add(eval_case)
        await db.flush()

        logger.info(
            "Eval case created",
            case_id=str(eval_case.id),
            skill_id=str(eval_case.skill_id) if eval_case.skill_id else None,
            user_id=user.user_id,
        )
        return eval_case


@router.patch("/eval-cases/{case_id}", response_model=EvalCaseOut)
async def update_eval_case(case_id: UUID, body: EvalCaseUpdateInput, user: AdminUser) -> EvalCaseOut:
    async with get_db_session() as db:
        eval_case = await _get_eval_case_or_404(db, case_id)
        updates = body.model_dump(exclude_unset=True)
        for field, value in updates.items():
            setattr(eval_case, field, value)
        await db.flush()

        logger.info("Eval case updated", case_id=str(eval_case.id), user_id=user.user_id)
        return eval_case


@router.delete("/eval-cases/{case_id}", response_model=DeleteResponse)
async def delete_eval_case(case_id: UUID, user: AdminUser) -> DeleteResponse:
    async with get_db_session() as db:
        eval_case = await _get_eval_case_or_404(db, case_id)
        eval_case.is_active = False
        await db.flush()

        logger.info("Eval case deactivated", case_id=str(eval_case.id), user_id=user.user_id)
        return DeleteResponse(deleted=True)


@router.get("/skill-evals", response_model=SkillEvalRecordPage)
async def list_skill_evals(
    user: AdminUser,
    skill_id: UUID | None = Query(None),
    run_id: UUID | None = Query(None),
    recommendation: str | None = Query(None),
    did_improve: bool | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
) -> SkillEvalRecordPage:
    del user

    async with get_db_session() as db:
        query = select(SkillEvalRecord)
        if skill_id:
            query = query.where(SkillEvalRecord.skill_id == skill_id)
        if run_id:
            query = query.where(SkillEvalRecord.run_id == run_id)
        if recommendation:
            query = query.where(SkillEvalRecord.recommendation == recommendation)
        if did_improve is not None:
            query = query.where(SkillEvalRecord.did_improve == did_improve)

        total_result = await db.execute(select(func.count()).select_from(query.subquery()))
        total = total_result.scalar_one()

        result = await db.execute(
            query
            .order_by(SkillEvalRecord.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        items = list(result.scalars().all())

    return SkillEvalRecordPage(items=items, total=total, page=page, page_size=page_size)


@router.get("/skill-evals/{eval_id}", response_model=SkillEvalRecordOut)
async def get_skill_eval(eval_id: UUID, user: AdminUser) -> SkillEvalRecordOut:
    del user

    async with get_db_session() as db:
        return await _get_skill_eval_or_404(db, eval_id)


@router.post("/run-cycle", response_model=QueueResponse)
async def run_cycle(user: AdminUser) -> QueueResponse:
    import arq

    settings = get_settings()
    pool = await arq.create_pool(arq.connections.RedisSettings.from_dsn(settings.dragonfly_url))
    try:
        await pool.enqueue_job("run_evolution_cycle")
    finally:
        await pool.aclose()

    logger.info("Evolution cycle queued", user_id=user.user_id)
    return QueueResponse(status="queued", message="Evolution cycle queued")
