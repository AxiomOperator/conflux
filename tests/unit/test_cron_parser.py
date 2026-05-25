from datetime import datetime, timezone

import pytest

from conflux.scheduler.cron_parser import next_run_time, parse_schedule, validate_cron


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("every day at 9am", "0 9 * * *"),
        ("daily at 9am", "0 9 * * *"),
        ("every weekday at 9am", "0 9 * * 1-5"),
        ("every weekday at 9am EST", "0 14 * * 1-5"),
        ("every Monday at 10am", "0 10 * * 1"),
        ("every hour", "0 * * * *"),
        ("every 30 minutes", "*/30 * * * *"),
        ("every 30 mins", "*/30 * * * *"),
        ("every 15 minutes", "*/15 * * * *"),
        ("every Sunday at midnight", "0 0 * * 0"),
        ("every Sunday at 12am", "0 0 * * 0"),
        ("every day at noon", "0 12 * * *"),
        ("every day at 12pm", "0 12 * * *"),
        ("twice a day", "0 9,17 * * *"),
        ("every Monday and Wednesday at 3pm", "0 15 * * 1,3"),
        ("every morning at 8am", "0 8 * * *"),
        ("every evening at 6pm", "0 18 * * *"),
        ("at midnight", "0 0 * * *"),
        ("every midnight", "0 0 * * *"),
        ("0 9 * * *", "0 9 * * *"),
    ],
)
def test_parse_schedule_examples(text: str, expected: str) -> None:
    assert parse_schedule(text) == expected


def test_parse_schedule_shifts_weekday_when_timezone_wraps() -> None:
    assert parse_schedule("every Sunday at 11pm PST") == "0 7 * * 1"


def test_parse_schedule_raises_for_unparseable_text() -> None:
    with pytest.raises(ValueError, match="Could not parse schedule"):
        parse_schedule("whenever you feel like it")


def test_validate_cron() -> None:
    assert validate_cron("0 9 * * *") is True
    assert validate_cron("not a cron") is False


def test_next_run_time_returns_utc_datetime() -> None:
    base = datetime(2024, 1, 1, 8, 30, tzinfo=timezone.utc)
    assert next_run_time("0 9 * * *", base=base) == datetime(
        2024,
        1,
        1,
        9,
        0,
        tzinfo=timezone.utc,
    )
