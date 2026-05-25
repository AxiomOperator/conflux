"""Offline evolution pipeline for eval-driven skill improvement."""

from __future__ import annotations

import json
import re
from typing import Any
from uuid import UUID

import structlog

from conflux.core.database import get_db_session
from conflux.learning.pattern_detector import detect_patterns

logger = structlog.get_logger(__name__)

_DIMENSION_WEIGHTS = {
    "accuracy": 0.2,
    "task_completion_rate": 0.2,
    "failure_reduction": 0.15,
    "reliability": 0.15,
    "tool_use_correctness": 0.1,
    "output_quality": 0.1,
    "latency_impact": 0.05,
    "regression_risk": 0.05,
}


async def run_evolution_cycle(ctx: dict[str, Any]) -> dict[str, Any]:
    """arq job: run one evolution cycle without raising background-job exceptions."""
    from sqlalchemy import select

    summary = {
        "status": "ok",
        "patterns_processed": 0,
        "candidates_created": 0,
        "promoted": 0,
        "rejected": 0,
        "quarantined": 0,
    }

    logger.info("evolution_cycle_started")

    try:
        detected_patterns = await detect_patterns()
        covered_skill_ids = {
            pattern["skill_id"]
            for pattern in detected_patterns
            if isinstance(pattern.get("skill_id"), str) and pattern["skill_id"]
        }

        from conflux.models.learning import ImprovementPattern

        async with get_db_session() as db:
            pattern_result = await db.execute(
                select(ImprovementPattern)
                .where(ImprovementPattern.status == "new")
                .order_by(ImprovementPattern.detected_at.desc())
            )
            new_patterns = pattern_result.scalars().all()

        for pattern in new_patterns:
            try:
                skill_id = str(pattern.skill_id) if pattern.skill_id else ""
                eval_cases = await _generate_eval_cases(pattern, skill_id)
                candidate = await _generate_candidate_from_pattern(pattern)
                if candidate is not None:
                    candidate["eval_cases"] = eval_cases
                    record_id = await _save_candidate(candidate)
                    if record_id:
                        candidate["record_id"] = record_id
                        summary["candidates_created"] += 1
                        scores = await _score_candidate(candidate, eval_cases)
                        decision = await _decide_candidate(candidate, scores)
                        if decision == "promote":
                            summary["promoted"] += 1
                        elif decision == "reject":
                            summary["rejected"] += 1
                        elif decision == "quarantine":
                            summary["quarantined"] += 1
            except Exception as exc:  # pragma: no cover - batch safety
                logger.warning(
                    "pattern_processing_failed",
                    pattern_id=str(pattern.id),
                    pattern_type=pattern.pattern_type,
                    error=str(exc),
                )
            finally:
                if await _mark_pattern_processed(pattern.id):
                    summary["patterns_processed"] += 1

        failed_skills = await _find_failing_skills(days=7, min_failures=3)
        for skill_id, failure_count in failed_skills:
            if skill_id in covered_skill_ids:
                continue
            try:
                candidate = await _generate_candidate(skill_id, failure_count)
                if candidate:
                    record_id = await _save_candidate(candidate)
                    if record_id:
                        summary["candidates_created"] += 1
            except Exception as exc:  # pragma: no cover - batch safety
                logger.warning("candidate_generation_failed", skill_id=skill_id, error=str(exc))

        logger.info("evolution_cycle_complete", **summary)
        return summary
    except Exception as exc:  # pragma: no cover - background safety
        logger.exception("evolution_cycle_failed", error=str(exc))
        summary["status"] = "error"
        summary["error"] = str(exc)
        return summary


async def _find_failing_skills(days: int, min_failures: int) -> list[tuple[str, int]]:
    """Find skills that have failed recently."""
    from sqlalchemy import func, select, text

    from conflux.models.skill import SkillFailureEvent

    async with get_db_session() as db:
        result = await db.execute(
            select(SkillFailureEvent.skill_id, func.count().label("cnt"))
            .where(SkillFailureEvent.created_at >= text(f"NOW() - INTERVAL '{days} days'"))
            .group_by(SkillFailureEvent.skill_id)
            .having(func.count() >= min_failures)
        )
        return [(str(row.skill_id), int(row.cnt)) for row in result.all()]


async def _generate_candidate(skill_id: str, failure_count: int) -> dict[str, Any] | None:
    """Use LLM to generate an improved skill variant."""
    from conflux.providers.base import ChatMessage, CompletionRequest
    from conflux.providers.registry import get_provider_registry

    current_content = await _load_active_skill_content(skill_id)
    if current_content is None:
        return None

    registry = get_provider_registry()
    provider = registry.get_default()

    prompt = f"""
The following skill has failed {failure_count} times recently.
Please analyze it and propose an improved version that is clearer,
more robust, and avoids common failure modes.

Current skill content:
---
{current_content}
---

Return the improved skill content as a complete SKILL.md markdown document.
Include a brief explanation of what you changed and why.
""".strip()

    request = CompletionRequest(
        messages=[ChatMessage(role="user", content=prompt)],
        model=registry.get_default_model_name(),
        stream=False,
    )
    response = await provider.complete(request)
    if not response.content:
        return None

    return {
        "skill_id": skill_id,
        "current_content": current_content,
        "proposed_content": response.content,
        "rationale": f"Proposed improvement after {failure_count} failure events",
        "candidate_type": "skill",
    }


async def _save_candidate(candidate: dict[str, Any]) -> str | None:
    from conflux.models.learning import EvolutionCandidate

    async with get_db_session() as db:
        record = EvolutionCandidate(
            skill_id=_coerce_uuid(candidate.get("skill_id")),
            candidate_type=str(candidate.get("candidate_type", "skill")),
            current_content=str(candidate.get("current_content", "")),
            proposed_content=str(candidate.get("proposed_content", "")),
            rationale=candidate.get("rationale"),
            approval_status=str(candidate.get("approval_status", "pending")),
            eval_dataset={"eval_cases": candidate.get("eval_cases", [])} if candidate.get("eval_cases") else None,
            detected_pattern=candidate.get("detected_pattern"),
            pattern_id=_coerce_uuid(candidate.get("pattern_id")),
        )
        db.add(record)
        await db.flush()
        return str(record.id)


async def _generate_eval_cases(pattern: Any, skill_id: str) -> list[dict[str, Any]]:
    """Generate evaluation cases from run history for this pattern."""
    from conflux.models.learning import EvalCase
    from conflux.providers.base import ChatMessage, CompletionRequest
    from conflux.providers.registry import get_provider_registry

    if not skill_id:
        return []

    recent_events = await _load_recent_skill_trace_events(skill_id, limit=20)
    if not recent_events:
        return []

    trace_history = [
        {
            "run_id": event["run_id"],
            "event_type": event["event_type"],
            "payload": event["payload"],
        }
        for event in recent_events
    ]

    prompt = f"""
You are generating evaluation cases for a skill improvement pipeline.
Create 3 to 5 JSON evaluation cases for the skill tied to pattern '{pattern.pattern_type}'.
You must cover:
- one known failure case
- one success-regression case
- one edge case

Pattern description:
{pattern.description}

Pattern evidence:
{json.dumps(pattern.evidence or {}, ensure_ascii=False)[:4000]}

Recent trace events:
{json.dumps(trace_history, ensure_ascii=False)[:8000]}

Return ONLY a JSON array. Each item must have:
- case_type
- description
- input_context (object)
- expected_behavior
- acceptance_criteria
- source_run_id (optional)
- tags (array)
""".strip()

    cases: list[dict[str, Any]] = []
    try:
        registry = get_provider_registry()
        provider = registry.get_default()
        response = await provider.complete(
            CompletionRequest(
                messages=[ChatMessage(role="user", content=prompt)],
                model=registry.get_default_model_name(),
                stream=False,
            )
        )
        parsed = _parse_json_content(response.content or "", expect="array")
        if isinstance(parsed, list):
            cases = [_normalize_eval_case(item, pattern) for item in parsed if isinstance(item, dict)]
    except Exception as exc:  # pragma: no cover - provider safety
        logger.warning("eval_case_generation_failed", skill_id=skill_id, error=str(exc))

    if len(cases) < 3:
        source_run_id = next((event["run_id"] for event in recent_events if event.get("run_id")), None)
        cases = _fallback_eval_cases(pattern, source_run_id)

    saved_cases: list[dict[str, Any]] = []
    async with get_db_session() as db:
        for case in cases[:5]:
            record = EvalCase(
                skill_id=_coerce_uuid(skill_id),
                case_type=str(case.get("case_type", "edge_case")),
                description=str(case.get("description", pattern.description)),
                input_context=case.get("input_context") if isinstance(case.get("input_context"), dict) else {},
                expected_behavior=str(case.get("expected_behavior", "Preserve intended behavior.")),
                acceptance_criteria=case.get("acceptance_criteria"),
                source="auto_generated",
                source_run_id=_coerce_uuid(case.get("source_run_id")),
                tags=case.get("tags") if isinstance(case.get("tags"), list) else [],
            )
            db.add(record)
            await db.flush()
            saved_cases.append(
                {
                    "id": str(record.id),
                    "case_type": record.case_type,
                    "description": record.description,
                    "input_context": record.input_context,
                    "expected_behavior": record.expected_behavior,
                    "acceptance_criteria": record.acceptance_criteria,
                    "source_run_id": str(record.source_run_id) if record.source_run_id else None,
                    "tags": record.tags or [],
                }
            )
    return saved_cases


async def _generate_candidate_from_pattern(pattern: Any) -> dict[str, Any] | None:
    """Generate improvement candidate from a detected pattern."""
    from conflux.providers.base import ChatMessage, CompletionRequest
    from conflux.providers.registry import get_provider_registry

    skill_id = str(pattern.skill_id) if pattern.skill_id else ""
    current_content = await _load_active_skill_content(skill_id)
    if current_content is None:
        return None

    prompt = f"""
You are improving a skill in response to a detected behavior pattern.
Return ONLY JSON with keys:
- proposed_content: full revised SKILL.md content
- rationale: concise explanation of the improvement
- expected_benefit: what should improve
- dimensions_improved: array of relevant scoring dimensions

Detected pattern type: {pattern.pattern_type}
Description: {pattern.description}
Evidence: {json.dumps(pattern.evidence or {}, ensure_ascii=False)[:5000]}

Current skill content:
---
{current_content}
---
""".strip()

    try:
        registry = get_provider_registry()
        provider = registry.get_default()
        response = await provider.complete(
            CompletionRequest(
                messages=[ChatMessage(role="user", content=prompt)],
                model=registry.get_default_model_name(),
                stream=False,
            )
        )
        parsed = _parse_json_content(response.content or "", expect="object")
        if isinstance(parsed, dict):
            proposed_content = str(parsed.get("proposed_content", "")).strip()
            if proposed_content:
                expected_benefit = str(parsed.get("expected_benefit", "")).strip()
                dimensions_improved = parsed.get("dimensions_improved") if isinstance(parsed.get("dimensions_improved"), list) else []
                rationale = str(parsed.get("rationale", "")).strip() or f"Pattern-driven improvement for {pattern.pattern_type}"
                return {
                    "skill_id": skill_id,
                    "current_content": current_content,
                    "proposed_content": proposed_content,
                    "rationale": rationale,
                    "candidate_type": "skill",
                    "detected_pattern": pattern.pattern_type,
                    "pattern_id": str(pattern.id),
                    "expected_benefit": expected_benefit,
                    "dimensions_improved": dimensions_improved,
                }
    except Exception as exc:  # pragma: no cover - provider safety
        logger.warning("pattern_candidate_generation_failed", pattern_id=str(pattern.id), error=str(exc))

    return None


async def _score_candidate(candidate: dict[str, Any], eval_cases: list[dict[str, Any]]) -> dict[str, Any]:
    """Score candidate against eval cases using an LLM across 8 dimensions."""
    from conflux.providers.base import ChatMessage, CompletionRequest
    from conflux.providers.registry import get_provider_registry

    default_scores = {dimension: 0.5 for dimension in _DIMENSION_WEIGHTS}
    default_scores["overall"] = _compute_overall_score(default_scores)
    default_scores["notes"] = "Fallback score used because evaluation output was unavailable."

    prompt = f"""
Evaluate the proposed skill revision against the provided evaluation cases.
Return ONLY JSON with numeric scores from 0.0 to 1.0 for:
- accuracy
- task_completion_rate
- failure_reduction
- reliability
- tool_use_correctness
- output_quality
- latency_impact
- regression_risk
Also include a short 'notes' string.

Current content:
---
{candidate.get('current_content', '')}
---

Proposed content:
---
{candidate.get('proposed_content', '')}
---

Evaluation cases:
{json.dumps(eval_cases, ensure_ascii=False)[:8000]}
""".strip()

    try:
        registry = get_provider_registry()
        provider = registry.get_default()
        response = await provider.complete(
            CompletionRequest(
                messages=[ChatMessage(role="user", content=prompt)],
                model=registry.get_default_model_name(),
                stream=False,
            )
        )
        parsed = _parse_json_content(response.content or "", expect="object")
        if not isinstance(parsed, dict):
            return default_scores

        scores: dict[str, Any] = {"notes": str(parsed.get("notes", "")).strip()}
        for dimension in _DIMENSION_WEIGHTS:
            scores[dimension] = _clamp_score(parsed.get(dimension, 0.5))
        scores["overall"] = _compute_overall_score(scores)
        return scores
    except Exception as exc:  # pragma: no cover - provider safety
        logger.warning("candidate_scoring_failed", skill_id=candidate.get("skill_id"), error=str(exc))
        return default_scores


async def _decide_candidate(candidate: dict[str, Any], scores: dict[str, Any]) -> str:
    """Make Promote/Reject/Quarantine decision and persist it on the candidate record."""
    from sqlalchemy import update

    from conflux.models.learning import EvolutionCandidate

    overall = float(scores.get("overall", 0.0) or 0.0)
    regression_risk = float(scores.get("regression_risk", 0.0) or 0.0)

    if overall >= 0.75 and regression_risk >= 0.6:
        decision = "promote"
        reason = f"Overall score {overall:.2f} with acceptable regression safety {regression_risk:.2f}."
    elif overall >= 0.55:
        decision = "quarantine"
        reason = f"Candidate is promising but needs more validation (overall={overall:.2f})."
    else:
        decision = "reject"
        reason = f"Candidate underperformed evaluation thresholds (overall={overall:.2f})."

    notes = str(scores.get("notes", "")).strip()
    if notes:
        reason = f"{reason} {notes}".strip()

    record_id = _coerce_uuid(candidate.get("record_id"))
    if record_id is not None:
        approval_status = "rejected" if decision == "reject" else "pending"
        async with get_db_session() as db:
            await db.execute(
                update(EvolutionCandidate)
                .where(EvolutionCandidate.id == record_id)
                .values(
                    decision=decision,
                    decision_reason=reason,
                    comparison_scores=scores,
                    eval_score=overall,
                    test_results={
                        "eval_case_count": len(candidate.get("eval_cases", [])),
                        "decision": decision,
                        "notes": notes,
                    },
                    approval_status=approval_status,
                )
            )

    return decision


async def _mark_pattern_processed(pattern_id: UUID | str) -> bool:
    from sqlalchemy import update

    from conflux.models.learning import ImprovementPattern

    try:
        async with get_db_session() as db:
            await db.execute(
                update(ImprovementPattern)
                .where(ImprovementPattern.id == _coerce_uuid(pattern_id))
                .values(status="processed")
            )
        return True
    except Exception as exc:  # pragma: no cover - best effort status update
        logger.warning("pattern_status_update_failed", pattern_id=str(pattern_id), error=str(exc))
        return False


async def _load_active_skill_content(skill_id: str) -> str | None:
    from sqlalchemy import select

    from conflux.models.skill import Skill, SkillVersion

    skill_uuid = _coerce_uuid(skill_id)
    if skill_uuid is None:
        return None

    async with get_db_session() as db:
        skill_result = await db.execute(select(Skill).where(Skill.id == skill_uuid))
        skill = skill_result.scalar_one_or_none()
        if skill is None or not skill.active_version_id:
            return None

        version_result = await db.execute(
            select(SkillVersion).where(SkillVersion.id == skill.active_version_id)
        )
        version = version_result.scalar_one_or_none()
        if version is None:
            return None
        return version.content


async def _load_recent_skill_trace_events(skill_id: str, limit: int = 20) -> list[dict[str, Any]]:
    from sqlalchemy import select

    from conflux.models.learning import TraceEvent
    from conflux.models.skill import SkillFailureEvent, SkillUsageEvent

    skill_uuid = _coerce_uuid(skill_id)
    if skill_uuid is None:
        return []

    async with get_db_session() as db:
        usage_result = await db.execute(
            select(SkillUsageEvent.run_id)
            .where(SkillUsageEvent.skill_id == skill_uuid)
            .order_by(SkillUsageEvent.created_at.desc())
            .limit(limit)
        )
        failure_result = await db.execute(
            select(SkillFailureEvent.run_id)
            .where(SkillFailureEvent.skill_id == skill_uuid)
            .order_by(SkillFailureEvent.created_at.desc())
            .limit(limit)
        )
        run_ids = [*usage_result.scalars().all(), *failure_result.scalars().all()]
        deduped_run_ids: list[UUID] = []
        seen_run_ids: set[UUID] = set()
        for run_id in run_ids:
            if run_id in seen_run_ids:
                continue
            seen_run_ids.add(run_id)
            deduped_run_ids.append(run_id)

        if not deduped_run_ids:
            return []

        trace_result = await db.execute(
            select(TraceEvent)
            .where(TraceEvent.run_id.in_(deduped_run_ids))
            .order_by(TraceEvent.created_at.desc())
            .limit(limit)
        )
        return [
            {
                "run_id": str(event.run_id),
                "event_type": event.event_type,
                "payload": event.payload,
            }
            for event in trace_result.scalars().all()
        ]


def _fallback_eval_cases(pattern: Any, source_run_id: str | None) -> list[dict[str, Any]]:
    return [
        {
            "case_type": "known_failure",
            "description": f"Reproduce the known failure mode behind {pattern.pattern_type}.",
            "input_context": {"pattern_type": pattern.pattern_type, "scenario": "known_failure"},
            "expected_behavior": "The improved skill should avoid the previously observed failure pattern.",
            "acceptance_criteria": "No repeat of the failure signal and the response remains task-complete.",
            "source_run_id": source_run_id,
            "tags": [pattern.pattern_type, "auto", "failure"],
        },
        {
            "case_type": "success_regression",
            "description": "Confirm the existing successful behavior is preserved.",
            "input_context": {"pattern_type": pattern.pattern_type, "scenario": "success_regression"},
            "expected_behavior": "The improved skill preserves previously successful behavior without regressions.",
            "acceptance_criteria": "Output quality and task completion remain at least as strong as baseline.",
            "source_run_id": source_run_id,
            "tags": [pattern.pattern_type, "auto", "regression"],
        },
        {
            "case_type": "edge_case",
            "description": f"Exercise an edge case adjacent to the {pattern.pattern_type} pattern.",
            "input_context": {"pattern_type": pattern.pattern_type, "scenario": "edge_case"},
            "expected_behavior": "The skill handles adjacent edge cases gracefully and avoids brittle behavior.",
            "acceptance_criteria": "No new failure mode is introduced under edge-case inputs.",
            "source_run_id": source_run_id,
            "tags": [pattern.pattern_type, "auto", "edge"],
        },
    ]


def _normalize_eval_case(case: dict[str, Any], pattern: Any) -> dict[str, Any]:
    tags = case.get("tags") if isinstance(case.get("tags"), list) else []
    return {
        "case_type": str(case.get("case_type", "edge_case")),
        "description": str(case.get("description", pattern.description)),
        "input_context": case.get("input_context") if isinstance(case.get("input_context"), dict) else {},
        "expected_behavior": str(case.get("expected_behavior", "Maintain quality while addressing the pattern.")),
        "acceptance_criteria": str(case.get("acceptance_criteria", "Candidate passes the intended behavior check.")),
        "source_run_id": case.get("source_run_id"),
        "tags": [str(tag) for tag in tags[:10]],
    }


def _parse_json_content(content: str, expect: str) -> dict[str, Any] | list[Any] | None:
    text = (content or "").strip()
    if not text:
        return None

    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)

    candidates = [text]
    if expect == "object":
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            candidates.append(match.group())
    else:
        match = re.search(r"\[.*\]", text, re.DOTALL)
        if match:
            candidates.append(match.group())

    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if expect == "object" and isinstance(parsed, dict):
            return parsed
        if expect == "array" and isinstance(parsed, list):
            return parsed
    return None


def _coerce_uuid(value: Any) -> UUID | None:
    if value is None or value == "":
        return None
    if isinstance(value, UUID):
        return value
    try:
        return UUID(str(value))
    except (TypeError, ValueError, AttributeError):
        return None


def _clamp_score(value: Any) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        numeric = 0.5
    return max(0.0, min(1.0, numeric))


def _compute_overall_score(scores: dict[str, Any]) -> float:
    total = 0.0
    for dimension, weight in _DIMENSION_WEIGHTS.items():
        total += _clamp_score(scores.get(dimension, 0.5)) * weight
    return round(total, 4)
