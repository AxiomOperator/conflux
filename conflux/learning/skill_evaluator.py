from __future__ import annotations

import json
import re
from typing import Any

import structlog

from conflux.core.config import get_settings
from conflux.core.database import get_db_session

logger = structlog.get_logger(__name__)

SKILL_EVAL_SYSTEM_PROMPT = """
You are the Conflux Skill Evaluator. Silently assess whether the given skill improved the agent's task outcome.

Return ONLY valid JSON:
{
  "did_improve": true,
  "improvement_detail": "Specific description of what the skill improved",
  "dimensions_improved": ["accuracy", "speed", "tool_use", "output_quality", "reliability"],
  "negative_effects": "Any errors, delays, or confusion introduced by the skill (null if none)",
  "counterfactual_worse": true,
  "evidence_strength": 0.8,
  "recommendation": "keep",
  "eval_notes": "Brief internal notes"
}

Fields:
- did_improve: true if the skill measurably contributed to a better outcome
- dimensions_improved: list from: accuracy, speed, reasoning_quality, tool_use, output_quality, reliability, user_satisfaction
- counterfactual_worse: true if the result would likely have been worse without the skill
- evidence_strength: 0.0-1.0, how certain you are based on the evidence
- recommendation: one of: keep, update, deprecate, review_later
- All fields required. Be concise in text fields.
""".strip()

_ALLOWED_DIMENSIONS = {
    "accuracy",
    "speed",
    "reasoning_quality",
    "tool_use",
    "output_quality",
    "reliability",
    "user_satisfaction",
}
_ALLOWED_RECOMMENDATIONS = {"keep", "update", "deprecate", "review_later"}


async def skill_evaluation_job(ctx: dict[str, Any], run_id: str) -> dict[str, Any]:
    """
    arq job: silently evaluate each skill used in a run.

    Runs after every run that used at least one skill.
    Never interrupts the user — fully silent background assessment.
    Produces SkillEvalRecord for each skill used.
    """
    logger.info("Skill evaluation job started", run_id=run_id)

    try:
        run_info = await _load_run(run_id)
        if not run_info:
            logger.warning("Skill evaluation skipped; run not found", run_id=run_id)
            return {"status": "skipped", "reason": "run_not_found"}

        usage_events = await _load_skill_usage_events(run_id)
        trace = await _load_trace(run_id)

        if not usage_events:
            logger.info("No skill usage events found, skipping skill evaluation", run_id=run_id)
            return {"status": "skipped", "reason": "no_skill_usage"}

        from conflux.providers.base import ChatMessage, CompletionRequest
        from conflux.providers.registry import get_provider_registry

        registry = get_provider_registry()
        provider = registry.get_default()

        evals_created = 0
        for usage in _group_skill_usage_events(usage_events):
            skill_id = usage["skill_id"]

            try:
                if await _skill_eval_exists(run_id, skill_id):
                    logger.info(
                        "Skill evaluation already exists, skipping",
                        run_id=run_id,
                        skill_id=skill_id,
                    )
                    continue

                skill_bundle = await _load_skill_bundle(skill_id)
                if not skill_bundle:
                    logger.warning(
                        "Skill evaluation skipped; skill not found",
                        run_id=run_id,
                        skill_id=skill_id,
                    )
                    continue

                task_context = _build_task_context(run_info, trace, skill_bundle, usage)
                request = CompletionRequest(
                    messages=[
                        ChatMessage(role="system", content=SKILL_EVAL_SYSTEM_PROMPT),
                        ChatMessage(role="user", content=task_context),
                    ],
                    model=registry.get_default_model_name(),
                    temperature=0.0,
                    stream=False,
                )

                response = await provider.complete(request)
                assessment = _parse_skill_eval_output(response.content or "")
                if not assessment:
                    logger.warning(
                        "Skill evaluation returned malformed JSON",
                        run_id=run_id,
                        skill_id=skill_id,
                    )
                    continue

                selection_reason = _selection_reason_from_usage(usage)
                expected_benefit = _expected_benefit_for_skill(skill_bundle)

                await _save_skill_eval_record(
                    run_id=run_id,
                    skill_id=skill_id,
                    skill_version=skill_bundle.get("skill_version"),
                    task_context=task_context,
                    selection_reason=selection_reason,
                    expected_benefit=expected_benefit,
                    assessment=assessment,
                )

                if (
                    assessment["recommendation"] == "update"
                    and assessment["evidence_strength"] >= 0.7
                ):
                    await _create_improvement_pattern(
                        run_id=run_id,
                        skill_id=skill_id,
                        skill_bundle=skill_bundle,
                        selection_reason=selection_reason,
                        assessment=assessment,
                    )

                evals_created += 1
            except Exception as exc:  # pragma: no cover - per-skill background safety
                logger.warning(
                    "Skill evaluation failed for skill",
                    run_id=run_id,
                    skill_id=skill_id,
                    error=str(exc),
                )

        logger.info("Skill evaluation complete", run_id=run_id, evals_created=evals_created)
        return {"status": "ok", "evals_created": evals_created}
    except Exception as exc:  # pragma: no cover - background job safety
        logger.exception("Skill evaluation job failed", run_id=run_id, error=str(exc))
        return {"status": "error", "error": str(exc)}


async def schedule_skill_evaluation(run_id: str) -> None:
    """Schedule skill evaluation for a completed run if it used skills."""
    import arq

    from sqlalchemy import select

    from conflux.models.skill import SkillUsageEvent

    try:
        async with get_db_session() as db:
            result = await db.execute(
                select(SkillUsageEvent.id)
                .where(SkillUsageEvent.run_id == run_id)
                .limit(1)
            )
            has_skill_usage = result.first() is not None

        if not has_skill_usage:
            logger.debug("Skipping skill evaluation scheduling; no skill usage", run_id=run_id)
            return

        settings = get_settings()
        pool = await arq.create_pool(
            arq.connections.RedisSettings.from_dsn(settings.dragonfly_url)
        )
        try:
            await pool.enqueue_job("skill_evaluation_job", run_id)
        finally:
            await pool.aclose()
    except Exception as exc:  # pragma: no cover - fire-and-forget safety
        logger.warning(
            "Failed to schedule skill evaluation",
            run_id=run_id,
            error=str(exc),
        )


async def _load_run(run_id: str) -> dict[str, Any]:
    from sqlalchemy import select

    from conflux.models.agent import AgentRun

    async with get_db_session() as db:
        result = await db.execute(select(AgentRun).where(AgentRun.id == run_id))
        run = result.scalar_one_or_none()
        if run is None:
            return {}

        return {
            "id": str(run.id),
            "status": run.status,
            "input": run.input,
            "output": run.output,
        }


async def _load_skill_usage_events(run_id: str) -> list[dict[str, Any]]:
    from sqlalchemy import select

    from conflux.models.skill import SkillUsageEvent

    async with get_db_session() as db:
        result = await db.execute(
            select(SkillUsageEvent).where(SkillUsageEvent.run_id == run_id)
        )
        events = result.scalars().all()
        return [
            {
                "skill_id": str(event.skill_id),
                "was_helpful": event.was_helpful,
            }
            for event in events
        ]


async def _load_trace(run_id: str) -> list[dict[str, Any]]:
    from sqlalchemy import select

    from conflux.models.learning import TraceEvent

    async with get_db_session() as db:
        result = await db.execute(select(TraceEvent).where(TraceEvent.run_id == run_id))
        events = result.scalars().all()
        return [{"event_type": event.event_type, "payload": event.payload} for event in events]


async def _load_skill_bundle(skill_id: str) -> dict[str, Any] | None:
    from sqlalchemy import desc, select

    from conflux.models.skill import Skill, SkillVersion

    async with get_db_session() as db:
        skill_result = await db.execute(select(Skill).where(Skill.id == skill_id))
        skill = skill_result.scalar_one_or_none()
        if skill is None:
            return None

        version = None
        if skill.active_version_id:
            version_result = await db.execute(
                select(SkillVersion).where(SkillVersion.id == skill.active_version_id)
            )
            version = version_result.scalar_one_or_none()

        if version is None:
            fallback_result = await db.execute(
                select(SkillVersion)
                .where(SkillVersion.skill_id == skill.id)
                .order_by(desc(SkillVersion.version))
                .limit(1)
            )
            version = fallback_result.scalar_one_or_none()

        return {
            "skill_id": str(skill.id),
            "name": skill.name,
            "description": skill.description,
            "content": version.content if version else "",
            "skill_version": version.version if version else None,
        }


async def _skill_eval_exists(run_id: str, skill_id: str) -> bool:
    from sqlalchemy import select

    from conflux.models.learning import SkillEvalRecord

    async with get_db_session() as db:
        result = await db.execute(
            select(SkillEvalRecord.id)
            .where(SkillEvalRecord.run_id == run_id)
            .where(SkillEvalRecord.skill_id == skill_id)
            .limit(1)
        )
        return result.first() is not None


def _group_skill_usage_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    for event in events:
        skill_id = str(event.get("skill_id", "")).strip()
        if not skill_id:
            continue

        entry = grouped.setdefault(
            skill_id,
            {"skill_id": skill_id, "usage_count": 0, "was_helpful_values": []},
        )
        entry["usage_count"] += 1
        entry["was_helpful_values"].append(event.get("was_helpful"))

    return list(grouped.values())


def _build_task_context(
    run_info: dict[str, Any],
    trace: list[dict[str, Any]],
    skill_bundle: dict[str, Any],
    usage: dict[str, Any],
) -> str:
    tool_calls = [event for event in trace if event.get("event_type") == "tool_call"]
    errors = [event for event in trace if event.get("event_type") == "error"]
    completions = [event for event in trace if event.get("event_type") == "completion"]
    tools_used = sorted(
        {
            str(event.get("payload", {}).get("tool_name", "")).strip()
            for event in tool_calls
            if str(event.get("payload", {}).get("tool_name", "")).strip()
        }
    )
    error_samples = [
        _truncate(_payload_summary(event.get("payload", {})), 200)
        for event in errors[:3]
        if _payload_summary(event.get("payload", {}))
    ]
    completion_samples = [
        _truncate(_payload_summary(event.get("payload", {})), 200)
        for event in completions[:2]
        if _payload_summary(event.get("payload", {}))
    ]

    selection_signal = _selection_reason_from_usage(usage) or "No explicit helpfulness signal recorded."

    return (
        "Assess whether this skill improved the run outcome.\n\n"
        f"Run status: {run_info.get('status')}\n"
        f"Run input summary: {_truncate(_json_text(run_info.get('input')), 300)}\n"
        f"Run output summary: {_truncate(_json_text(run_info.get('output')), 300)}\n"
        f"Skill name: {skill_bundle.get('name')}\n"
        f"Skill description: {_truncate(skill_bundle.get('description'), 300)}\n"
        f"Skill content excerpt: {_truncate(skill_bundle.get('content'), 500)}\n"
        f"Skill usage count in run: {usage.get('usage_count', 0)}\n"
        f"Selection signal: {selection_signal}\n"
        f"Tool call events: {len(tool_calls)}\n"
        f"Error events: {len(errors)}\n"
        f"Completion events: {len(completions)}\n"
        f"Tools used: {tools_used}\n"
        f"Error samples: {error_samples}\n"
        f"Completion samples: {completion_samples}"
    )


def _parse_skill_eval_output(content: str) -> dict[str, Any] | None:
    text = content.strip()
    if not text:
        return None

    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        json_match = re.search(r"\{.*\}", text, re.DOTALL)
        if not json_match:
            return None
        try:
            parsed = json.loads(json_match.group())
        except json.JSONDecodeError:
            return None

    if not isinstance(parsed, dict):
        return None

    recommendation = str(parsed.get("recommendation", "review_later") or "review_later").strip().lower()
    if recommendation not in _ALLOWED_RECOMMENDATIONS:
        recommendation = "review_later"

    dimensions = [
        dimension
        for dimension in [str(item).strip() for item in parsed.get("dimensions_improved", []) or []]
        if dimension in _ALLOWED_DIMENSIONS
    ]

    return {
        "did_improve": _coerce_bool(parsed.get("did_improve")),
        "improvement_detail": _normalize_text(parsed.get("improvement_detail")),
        "dimensions_improved": dimensions,
        "negative_effects": _normalize_text(parsed.get("negative_effects")),
        "counterfactual_worse": _coerce_bool(parsed.get("counterfactual_worse")),
        "evidence_strength": _coerce_float(parsed.get("evidence_strength")),
        "recommendation": recommendation,
        "eval_notes": _normalize_text(parsed.get("eval_notes")),
    }


async def _save_skill_eval_record(
    *,
    run_id: str,
    skill_id: str,
    skill_version: int | None,
    task_context: str,
    selection_reason: str | None,
    expected_benefit: str | None,
    assessment: dict[str, Any],
) -> None:
    from conflux.models.learning import SkillEvalRecord

    async with get_db_session() as db:
        db.add(
            SkillEvalRecord(
                run_id=run_id,
                skill_id=skill_id,
                skill_version=skill_version,
                task_context=task_context,
                selection_reason=selection_reason,
                expected_benefit=expected_benefit,
                dimensions_improved=assessment["dimensions_improved"],
                negative_effects=assessment["negative_effects"],
                counterfactual_worse=assessment["counterfactual_worse"],
                evidence_strength=assessment["evidence_strength"],
                did_improve=assessment["did_improve"],
                improvement_detail=assessment["improvement_detail"],
                recommendation=assessment["recommendation"],
                eval_notes=assessment["eval_notes"],
            )
        )


async def _create_improvement_pattern(
    *,
    run_id: str,
    skill_id: str,
    skill_bundle: dict[str, Any],
    selection_reason: str | None,
    assessment: dict[str, Any],
) -> None:
    from conflux.models.learning import ImprovementPattern

    description = assessment.get("improvement_detail") or assessment.get("eval_notes") or (
        f"Skill '{skill_bundle.get('name')}' showed evidence of needing an update"
    )

    async with get_db_session() as db:
        db.add(
            ImprovementPattern(
                pattern_type="skill_eval_improvement_signal",
                skill_id=skill_id,
                frequency=1,
                severity=assessment.get("evidence_strength"),
                is_systemic=False,
                description=description,
                example_run_ids=[run_id],
                evidence={
                    "selection_reason": selection_reason,
                    "recommendation": assessment.get("recommendation"),
                    "did_improve": assessment.get("did_improve"),
                    "negative_effects": assessment.get("negative_effects"),
                    "eval_notes": assessment.get("eval_notes"),
                    "dimensions_improved": assessment.get("dimensions_improved", []),
                    "skill_version": skill_bundle.get("skill_version"),
                },
            )
        )


def _selection_reason_from_usage(usage: dict[str, Any]) -> str | None:
    helpful_values = [value for value in usage.get("was_helpful_values", []) if value is not None]
    if any(helpful_values):
        return "Run telemetry marked this skill as helpful."
    if helpful_values and all(value is False for value in helpful_values):
        return "Run telemetry marked this skill as not helpful."
    return None


def _expected_benefit_for_skill(skill_bundle: dict[str, Any]) -> str | None:
    description = _normalize_text(skill_bundle.get("description"))
    if description:
        return description
    return _normalize_text(skill_bundle.get("name"))


def _payload_summary(payload: dict[str, Any]) -> str:
    if not payload:
        return ""
    if isinstance(payload, dict):
        for key in ("error", "message", "content", "result", "result_preview"):
            value = payload.get(key)
            if value:
                return _json_text(value)
    return _json_text(payload)


def _json_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, ensure_ascii=False, default=str)
    except TypeError:
        return str(value)


def _truncate(value: Any, limit: int) -> str:
    text = _json_text(value)
    if len(text) <= limit:
        return text
    return f"{text[:limit - 3]}..."


def _normalize_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() == "null":
        return None
    return text


def _coerce_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "yes", "1"}:
            return True
        if lowered in {"false", "no", "0"}:
            return False
    return None


def _coerce_float(value: Any) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(1.0, numeric))
