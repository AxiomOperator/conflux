from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from conflux.core.database import get_db_session

logger = structlog.get_logger(__name__)


async def detect_patterns(days: int = 14) -> list[dict[str, Any]]:
    """Detect recurrent improvement patterns from recent run history."""
    try:
        from conflux.models.learning import ImprovementPattern
        from conflux.models.skill import SkillFailureEvent

        aggregates: dict[tuple[str, UUID | None], dict[str, Any]] = {}

        async with get_db_session() as db:
            run_skill_map = await _load_run_skill_map(db, days)
            traces_by_run = await _load_traces_by_run(db, days)
            failed_run_ids = await _load_failed_run_ids(db, days)

            workaround_buckets: dict[tuple[str, str], dict[str, Any]] = defaultdict(
                lambda: {"count": 0, "run_ids": set(), "skill_ids": set(), "examples": []}
            )

            for run_id, events in traces_by_run.items():
                related_skill_ids = run_skill_map.get(run_id) or {None}

                retry_info = _detect_retry_loop(events)
                if retry_info is not None:
                    _add_pattern_observation(
                        aggregates,
                        pattern_type="retry_loop",
                        skill_ids=related_skill_ids,
                        frequency=1,
                        severity=min(1.0, 0.45 + 0.1 * max(retry_info["max_streak"] - 3, 0)),
                        description=(
                            f"Tool '{retry_info['tool_name']}' was called {retry_info['max_streak']} times "
                            f"in sequence during run {run_id}."
                        ),
                        run_ids={run_id},
                        evidence={
                            "tool_name": retry_info["tool_name"],
                            "max_streak": retry_info["max_streak"],
                            "run_id": run_id,
                        },
                    )

                if any(event.event_type == "correction" for event in events):
                    _add_pattern_observation(
                        aggregates,
                        pattern_type="user_correction",
                        skill_ids=related_skill_ids,
                        frequency=1,
                        severity=0.55,
                        description=f"Run {run_id} contains correction events indicating user guidance was needed.",
                        run_ids={run_id},
                        evidence={"run_id": run_id, "correction_events": _count_event_type(events, "correction")},
                    )

                low_confidence = _detect_low_confidence(events)
                if low_confidence is not None:
                    _add_pattern_observation(
                        aggregates,
                        pattern_type="low_confidence_output",
                        skill_ids=related_skill_ids,
                        frequency=1,
                        severity=min(1.0, 1.0 - low_confidence),
                        description=(
                            f"Run {run_id} produced a completion with low confidence ({low_confidence:.2f})."
                        ),
                        run_ids={run_id},
                        evidence={"run_id": run_id, "confidence": low_confidence},
                    )

                if run_id in failed_run_ids:
                    successful_tool_calls = _count_successful_tool_results(events)
                    if successful_tool_calls >= 5:
                        _add_pattern_observation(
                            aggregates,
                            pattern_type="partial_failure",
                            skill_ids=related_skill_ids,
                            frequency=1,
                            severity=min(1.0, 0.65 + 0.04 * max(successful_tool_calls - 5, 0)),
                            description=(
                                f"Run {run_id} failed after {successful_tool_calls} successful tool calls, "
                                "suggesting a late-stage breakdown."
                            ),
                            run_ids={run_id},
                            evidence={"run_id": run_id, "successful_tool_calls": successful_tool_calls},
                        )

                for event in events:
                    if event.event_type != "tool_result":
                        continue
                    tool_name = _extract_tool_name(event)
                    error_message = _extract_tool_error(event)
                    if not tool_name or not error_message:
                        continue
                    bucket = workaround_buckets[(tool_name, error_message)]
                    bucket["count"] += 1
                    bucket["run_ids"].add(run_id)
                    bucket["skill_ids"].update(skill_id for skill_id in related_skill_ids if skill_id)
                    if len(bucket["examples"]) < 5:
                        bucket["examples"].append({"run_id": run_id, "tool_name": tool_name, "error": error_message})

            failure_rows = await db.execute(
                select(
                    SkillFailureEvent.skill_id,
                    SkillFailureEvent.run_id,
                    SkillFailureEvent.failure_reason,
                ).where(SkillFailureEvent.created_at >= text(f"NOW() - INTERVAL '{int(days)} days'"))
            )
            failures_by_skill: dict[UUID, dict[str, Any]] = defaultdict(
                lambda: {"count": 0, "run_ids": set(), "reasons": []}
            )
            for row in failure_rows:
                bucket = failures_by_skill[row.skill_id]
                bucket["count"] += 1
                if row.run_id:
                    bucket["run_ids"].add(str(row.run_id))
                if row.failure_reason and len(bucket["reasons"]) < 5:
                    bucket["reasons"].append(row.failure_reason)

            for skill_id, bucket in failures_by_skill.items():
                if bucket["count"] < 3:
                    continue
                _add_pattern_observation(
                    aggregates,
                    pattern_type="repeated_tool_failure",
                    skill_ids={skill_id},
                    frequency=bucket["count"],
                    severity=min(1.0, 0.6 + 0.05 * max(bucket["count"] - 3, 0)),
                    description=(
                        f"Skill {skill_id} logged {bucket['count']} failure events in the last {days} days."
                    ),
                    run_ids=set(bucket["run_ids"]),
                    evidence={
                        "failure_reasons": bucket["reasons"],
                        "failure_count": bucket["count"],
                        "run_ids": sorted(bucket["run_ids"]),
                    },
                )

            for (tool_name, error_message), bucket in workaround_buckets.items():
                if bucket["count"] < 3 or len(bucket["run_ids"]) < 2:
                    continue
                target_skill_ids = bucket["skill_ids"] or {None}
                _add_pattern_observation(
                    aggregates,
                    pattern_type="repeated_workaround",
                    skill_ids=target_skill_ids,
                    frequency=bucket["count"],
                    severity=min(1.0, 0.6 + 0.04 * max(bucket["count"] - 3, 0)),
                    description=(
                        f"Tool '{tool_name}' returned the same error across {len(bucket['run_ids'])} runs: "
                        f"{error_message[:180]}"
                    ),
                    run_ids=set(bucket["run_ids"]),
                    evidence={
                        "tool_name": tool_name,
                        "error_message": error_message,
                        "occurrences": bucket["count"],
                        "run_ids": sorted(bucket["run_ids"]),
                        "examples": bucket["examples"],
                    },
                )

            persisted_patterns: list[dict[str, Any]] = []
            for aggregate in aggregates.values():
                stmt = select(ImprovementPattern).where(
                    ImprovementPattern.pattern_type == aggregate["pattern_type"],
                    ImprovementPattern.detected_at >= text("NOW() - INTERVAL '7 days'"),
                )
                if aggregate["skill_id"] is None:
                    stmt = stmt.where(ImprovementPattern.skill_id.is_(None))
                else:
                    stmt = stmt.where(ImprovementPattern.skill_id == aggregate["skill_id"])

                existing = (await db.execute(stmt.order_by(ImprovementPattern.detected_at.desc()))).scalars().first()

                if existing is not None:
                    existing.frequency = int(existing.frequency or 0) + int(aggregate["frequency"])
                    existing.severity = max(existing.severity or 0.0, float(aggregate["severity"]))
                    existing.description = aggregate["description"]
                    existing.example_run_ids = _merge_unique(existing.example_run_ids or [], aggregate["example_run_ids"])
                    merged_runs = set(existing.example_run_ids or [])
                    evidence = dict(existing.evidence or {})
                    previous_runs = {
                        str(run_id)
                        for run_id in evidence.get("run_ids", [])
                        if isinstance(run_id, str)
                    }
                    merged_runs.update(previous_runs)
                    merged_runs.update(aggregate["run_ids"])
                    evidence.update(
                        {
                            **aggregate["evidence"],
                            "run_ids": sorted(merged_runs),
                            "distinct_run_count": len(merged_runs),
                            "last_detected_at": datetime.utcnow().isoformat(),
                        }
                    )
                    existing.evidence = evidence
                    existing.is_systemic = bool(
                        existing.frequency >= 5 or len(merged_runs) >= 3 or aggregate["distinct_skill_count"] >= 3
                    )
                    existing.status = "new"
                    existing.detected_at = datetime.utcnow()
                    persisted = existing
                else:
                    persisted = ImprovementPattern(
                        pattern_type=aggregate["pattern_type"],
                        skill_id=aggregate["skill_id"],
                        frequency=aggregate["frequency"],
                        severity=aggregate["severity"],
                        is_systemic=bool(
                            aggregate["frequency"] >= 5
                            or len(aggregate["run_ids"]) >= 3
                            or aggregate["distinct_skill_count"] >= 3
                        ),
                        description=aggregate["description"],
                        example_run_ids=aggregate["example_run_ids"],
                        evidence={
                            **aggregate["evidence"],
                            "run_ids": sorted(aggregate["run_ids"]),
                            "distinct_run_count": len(aggregate["run_ids"]),
                            "last_detected_at": datetime.utcnow().isoformat(),
                        },
                        status="new",
                    )
                    db.add(persisted)
                    await db.flush()

                persisted_patterns.append(
                    {
                        "id": str(persisted.id),
                        "pattern_type": persisted.pattern_type,
                        "skill_id": str(persisted.skill_id) if persisted.skill_id else None,
                        "frequency": int(persisted.frequency or 0),
                        "severity": float(persisted.severity or 0.0),
                        "is_systemic": bool(persisted.is_systemic),
                        "description": persisted.description,
                    }
                )

        logger.info("pattern_detection_complete", days=days, patterns=len(persisted_patterns))
        return persisted_patterns
    except Exception as exc:  # pragma: no cover - background safety
        logger.warning("pattern_detection_failed", days=days, error=str(exc))
        return []


async def _load_run_skill_map(db: AsyncSession, days: int) -> dict[str, set[UUID]]:
    from conflux.models.skill import SkillFailureEvent, SkillUsageEvent

    mapping: dict[str, set[UUID]] = defaultdict(set)

    usage_rows = await db.execute(
        select(SkillUsageEvent.run_id, SkillUsageEvent.skill_id).where(
            SkillUsageEvent.created_at >= text(f"NOW() - INTERVAL '{int(days)} days'")
        )
    )
    for row in usage_rows:
        mapping[str(row.run_id)].add(row.skill_id)

    failure_rows = await db.execute(
        select(SkillFailureEvent.run_id, SkillFailureEvent.skill_id).where(
            SkillFailureEvent.created_at >= text(f"NOW() - INTERVAL '{int(days)} days'")
        )
    )
    for row in failure_rows:
        mapping[str(row.run_id)].add(row.skill_id)

    return mapping


async def _load_traces_by_run(db: AsyncSession, days: int) -> dict[str, list[Any]]:
    from conflux.models.learning import TraceEvent

    result = await db.execute(
        select(TraceEvent)
        .where(TraceEvent.created_at >= text(f"NOW() - INTERVAL '{int(days)} days'"))
        .order_by(TraceEvent.run_id, TraceEvent.created_at.asc())
    )
    traces: dict[str, list[Any]] = defaultdict(list)
    for event in result.scalars().all():
        traces[str(event.run_id)].append(event)
    return traces


async def _load_failed_run_ids(db: AsyncSession, days: int) -> set[str]:
    from conflux.models.agent import AgentRun

    result = await db.execute(
        select(AgentRun.id).where(
            AgentRun.status == "failed",
            AgentRun.created_at >= text(f"NOW() - INTERVAL '{int(days)} days'"),
        )
    )
    return {str(run_id) for run_id in result.scalars().all()}


def _detect_retry_loop(events: list[Any]) -> dict[str, Any] | None:
    max_streak = 0
    current_streak = 0
    current_tool: str | None = None
    max_tool: str | None = None

    tool_call_events = [event for event in events if event.event_type == "tool_call"]
    for event in tool_call_events:
        tool_name = _extract_tool_name(event)
        if not tool_name:
            current_tool = None
            current_streak = 0
            continue

        if tool_name == current_tool:
            current_streak += 1
        else:
            current_tool = tool_name
            current_streak = 1

        if current_streak > max_streak:
            max_streak = current_streak
            max_tool = tool_name

    if max_streak < 3 or not max_tool:
        return None
    return {"tool_name": max_tool, "max_streak": max_streak}


def _detect_low_confidence(events: list[Any]) -> float | None:
    low_confidence_values: list[float] = []
    for event in events:
        if event.event_type != "completion":
            continue
        payload = event.payload or {}
        confidence = payload.get("confidence")
        if confidence is None and isinstance(payload.get("output"), dict):
            confidence = payload["output"].get("confidence")
        try:
            numeric = float(confidence)
        except (TypeError, ValueError):
            continue
        if numeric < 0.5:
            low_confidence_values.append(numeric)
    if not low_confidence_values:
        return None
    return min(low_confidence_values)


def _count_successful_tool_results(events: list[Any]) -> int:
    count = 0
    for event in events:
        if event.event_type != "tool_result":
            continue
        if _extract_tool_error(event) is None:
            count += 1
    return count


def _count_event_type(events: list[Any], event_type: str) -> int:
    return sum(1 for event in events if event.event_type == event_type)


def _extract_tool_name(event: Any) -> str | None:
    payload = event.payload or {}
    if isinstance(payload.get("tool_name"), str) and payload["tool_name"].strip():
        return payload["tool_name"].strip()
    input_payload = payload.get("input")
    if isinstance(input_payload, dict):
        name = input_payload.get("name") or input_payload.get("tool_name")
        if isinstance(name, str) and name.strip():
            return name.strip()
    return None


def _extract_tool_error(event: Any) -> str | None:
    payload = event.payload or {}
    result_payload = payload.get("result")
    if result_payload is None and isinstance(payload.get("output"), dict):
        result_payload = payload["output"].get("result")
    if isinstance(result_payload, dict):
        error = result_payload.get("error")
        if isinstance(error, str) and error.strip():
            return error.strip()
    return None


def _add_pattern_observation(
    aggregates: dict[tuple[str, UUID | None], dict[str, Any]],
    *,
    pattern_type: str,
    skill_ids: set[UUID | None],
    frequency: int,
    severity: float,
    description: str,
    run_ids: set[str],
    evidence: dict[str, Any],
) -> None:
    normalized_skill_ids = skill_ids or {None}
    for skill_id in normalized_skill_ids:
        key = (pattern_type, skill_id)
        if key not in aggregates:
            aggregates[key] = {
                "pattern_type": pattern_type,
                "skill_id": skill_id,
                "frequency": 0,
                "severity": 0.0,
                "description": description,
                "run_ids": set(),
                "example_run_ids": [],
                "distinct_skill_ids": set(),
                "evidence": {"observations": []},
            }

        aggregate = aggregates[key]
        aggregate["frequency"] += int(frequency)
        aggregate["severity"] = max(float(aggregate["severity"]), float(severity))
        aggregate["description"] = description
        aggregate["run_ids"].update(run_ids)
        if skill_id is not None:
            aggregate["distinct_skill_ids"].add(skill_id)
        aggregate["example_run_ids"] = _merge_unique(aggregate["example_run_ids"], sorted(run_ids))
        observations = aggregate["evidence"].setdefault("observations", [])
        if len(observations) < 10:
            observations.append(evidence)
        aggregate["evidence"].update(
            {
                "pattern_type": pattern_type,
                "frequency": aggregate["frequency"],
                "distinct_skill_count": len(aggregate["distinct_skill_ids"]),
            }
        )
        aggregate["distinct_skill_count"] = len(aggregate["distinct_skill_ids"])


def _merge_unique(existing: list[Any], new_items: list[Any]) -> list[Any]:
    merged: list[Any] = []
    seen: set[str] = set()
    for item in [*(existing or []), *(new_items or [])]:
        key = str(item)
        if key in seen:
            continue
        seen.add(key)
        merged.append(item)
    return merged[:10]
