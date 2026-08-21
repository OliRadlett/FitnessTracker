"""Shared test configuration and fixtures."""

import uuid
from datetime import date, datetime, timezone

import pytest

from app.services.cycling import calculate_power_tss, compute_training_load

# ── Pure function fixtures ──────────────────────────────────────────────────


@pytest.fixture
def sample_user_id():
    """A deterministic UUID for test users."""
    return uuid.UUID("12345678-1234-5678-1234-567812345678")


@pytest.fixture
def sample_daily_tss():
    """30 days of sample TSS data for training load tests."""
    from datetime import timedelta

    today = date.today()
    return [
        {"date": (today - timedelta(days=i)).isoformat(), "tss": 50.0 + (i % 7) * 10}
        for i in range(30, 0, -1)
    ]


@pytest.fixture
def sample_power_curve():
    """Sample power curve data for FTP estimation tests."""
    return {
        5: 800,
        10: 600,
        15: 500,
        30: 400,
        60: 350,
        120: 310,
        300: 280,
        600: 260,
        1200: 245,
        1800: 235,
        3600: 220,
    }
