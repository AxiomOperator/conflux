"""Rule-based natural-language schedule parsing.

Timezone abbreviations are treated as fixed UTC offsets and converted into UTC
cron expressions. Because cron expressions do not encode timezone metadata,
weekday-based schedules may shift to the previous or next UTC weekday when the
conversion crosses midnight.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from croniter import croniter

_TIMEZONE_OFFSETS = {
    "EST": -5,
    "CST": -6,
    "MST": -7,
    "PST": -8,
    "EDT": -4,
    "CDT": -5,
    "MDT": -6,
    "PDT": -7,
}

_WEEKDAY_VALUES = {
    "sunday": 0,
    "monday": 1,
    "tuesday": 2,
    "wednesday": 3,
    "thursday": 4,
    "friday": 5,
    "saturday": 6,
}

_TIME_RE = re.compile(
    r"\b(?P<spec>midnight|noon|\d{1,2}(?::\d{2})?\s*(?:am|pm))\b",
    re.IGNORECASE,
)


def validate_cron(expr: str) -> bool:
    """Return True when *expr* is a valid five-field cron expression."""
    return len(expr.split()) == 5 and croniter.is_valid(expr)


def next_run_time(expr: str, base: datetime | None = None) -> datetime:
    """Return the next UTC run time for a cron expression."""
    base_dt = base or datetime.now(timezone.utc)
    if base_dt.tzinfo is None:
        base_dt = base_dt.replace(tzinfo=timezone.utc)
    else:
        base_dt = base_dt.astimezone(timezone.utc)

    next_dt = croniter(expr, base_dt).get_next(datetime)
    if next_dt.tzinfo is None:
        return next_dt.replace(tzinfo=timezone.utc)
    return next_dt.astimezone(timezone.utc)


def parse_schedule(text: str) -> str:
    """Convert a supported natural-language schedule into a UTC cron expression."""
    raw = text.strip()
    if not raw:
        raise ValueError("Schedule text cannot be empty.")
    if validate_cron(raw):
        return raw

    normalized = _normalize_text(raw)

    if normalized == "every hour":
        return "0 * * * *"
    if normalized == "twice a day":
        return "0 9,17 * * *"
    if normalized in {"at midnight", "every midnight"}:
        return "0 0 * * *"

    minute_match = re.fullmatch(r"every\s+(\d+)\s*(?:minutes|minute|mins|min)", normalized)
    if minute_match:
        interval = int(minute_match.group(1))
        if not 1 <= interval <= 59:
            raise ValueError("Minute interval must be between 1 and 59.")
        return f"*/{interval} * * * *"

    hour_match = re.fullmatch(r"every\s+(\d+)\s*hours?", normalized)
    if hour_match:
        interval = int(hour_match.group(1))
        if not 1 <= interval <= 23:
            raise ValueError("Hour interval must be between 1 and 23.")
        return f"0 */{interval} * * *"

    timezone_name, normalized = _extract_timezone(normalized)
    time_match = _TIME_RE.search(normalized)
    if time_match is None:
        raise ValueError(_unparseable_message(text))

    minute, hour = _parse_time(time_match.group("spec"))
    hour, day_delta = _apply_timezone(hour, timezone_name)

    weekday_field = "*"
    if re.search(r"\bevery weekday\b", normalized):
        weekday_field = _format_weekdays(_shift_weekdays({1, 2, 3, 4, 5}, day_delta))
    elif re.search(r"\bevery weekend\b", normalized):
        weekday_field = _format_weekdays(_shift_weekdays({0, 6}, day_delta))
    else:
        named_days = _extract_named_days(normalized)
        if named_days:
            weekday_field = _format_weekdays(_shift_weekdays(named_days, day_delta))
        elif not _is_daily_schedule(normalized):
            raise ValueError(_unparseable_message(text))

    return f"{minute} {hour} * * {weekday_field}"


def _normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def _extract_timezone(text: str) -> tuple[str | None, str]:
    match = re.search(r"\b(est|cst|mst|pst|edt|cdt|mdt|pdt)\b", text, flags=re.IGNORECASE)
    if match is None:
        return None, text

    timezone_name = match.group(1).upper()
    cleaned = re.sub(rf"\b{match.group(1)}\b", "", text, count=1, flags=re.IGNORECASE)
    return timezone_name, _normalize_text(cleaned)


def _parse_time(spec: str) -> tuple[int, int]:
    lowered = spec.strip().lower().replace(" ", "")
    if lowered == "midnight":
        return 0, 0
    if lowered == "noon":
        return 0, 12

    match = re.fullmatch(r"(?P<hour>\d{1,2})(?::(?P<minute>\d{2}))?(?P<meridiem>am|pm)", lowered)
    if match is None:
        raise ValueError(f"Unsupported time value: {spec!r}")

    hour = int(match.group("hour"))
    minute = int(match.group("minute") or 0)
    meridiem = match.group("meridiem")

    if hour < 1 or hour > 12:
        raise ValueError(f"Hour must be between 1 and 12 in {spec!r}")
    if minute > 59:
        raise ValueError(f"Minute must be between 0 and 59 in {spec!r}")

    if meridiem == "am":
        hour = 0 if hour == 12 else hour
    else:
        hour = 12 if hour == 12 else hour + 12

    return minute, hour


def _apply_timezone(hour: int, timezone_name: str | None) -> tuple[int, int]:
    if timezone_name is None:
        return hour, 0

    day_delta, shifted_hour = divmod(hour - _TIMEZONE_OFFSETS[timezone_name], 24)
    return shifted_hour, day_delta


def _extract_named_days(text: str) -> set[int]:
    matches = re.findall(
        r"\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b",
        text,
        flags=re.IGNORECASE,
    )
    return {_WEEKDAY_VALUES[day.lower()] for day in matches}


def _shift_weekdays(days: set[int], day_delta: int) -> set[int]:
    if day_delta == 0:
        return set(days)
    return {(day + day_delta) % 7 for day in days}


def _format_weekdays(days: set[int]) -> str:
    ordered = sorted(days)
    if ordered == [1, 2, 3, 4, 5]:
        return "1-5"

    ranges: list[str] = []
    start = prev = ordered[0]
    for value in ordered[1:]:
        if value == prev + 1:
            prev = value
            continue
        ranges.append(f"{start}-{prev}" if start != prev else str(start))
        start = prev = value
    ranges.append(f"{start}-{prev}" if start != prev else str(start))
    return ",".join(ranges)


def _is_daily_schedule(text: str) -> bool:
    return any(
        re.search(pattern, text)
        for pattern in (
            r"\bevery day\b",
            r"\bdaily\b",
            r"\bevery morning\b",
            r"\bevery evening\b",
            r"^at ",
        )
    )


def _unparseable_message(text: str) -> str:
    return (
        f"Could not parse schedule {text!r}. Supported examples include "
        "'every day at 9am', 'every weekday at 9am', 'every Monday at 10am', "
        "and 'every 30 minutes'."
    )
