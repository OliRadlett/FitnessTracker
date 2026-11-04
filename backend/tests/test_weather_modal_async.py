"""`aanalyze_weather_on_modal` must not block the event loop.

Regression guard for the prod ``AsyncUsageWarning`` (sync Modal dispatch —
``with app.run()`` + ``.remote(...)``, ~30 s remote run — called directly
from the scheduler's ``async _run`` in ``analyze_weather_performance_weekly``,
blocking the loop). The async wrapper offloads to a worker thread, so:

1. the sync dispatch runs outside the loop thread with no running loop in
   that thread (the condition Modal's warning checks), and
2. the loop stays responsive while the remote call is in flight.

No Modal credentials needed — the sync dispatch is stubbed out.
"""

import asyncio
import threading
import time
from pathlib import Path

import app.integrations.weather_analysis as wa

SCHEDULER = Path(__file__).resolve().parents[1] / "app" / "tasks" / "scheduler.py"


async def test_async_wrapper_offloads_and_keeps_loop_responsive(monkeypatch):
    main_thread = threading.current_thread()
    seen: dict = {}

    def _fake_sync(rides, route_headings=None):
        seen["thread"] = threading.current_thread()
        try:
            asyncio.get_running_loop()
            seen["had_loop"] = True
        except RuntimeError:
            seen["had_loop"] = False
        seen["args"] = (rides, route_headings)
        time.sleep(0.3)  # simulate the blocking remote run
        return {"ok": True}

    monkeypatch.setattr(wa, "analyze_weather_on_modal", _fake_sync)

    ticks = 0

    async def _ticker():
        nonlocal ticks
        for _ in range(10):
            await asyncio.sleep(0.05)
            ticks += 1

    rides = [{"date": "2026-10-01"}]
    headings = {"route-1": 90.0}
    result, _ = await asyncio.gather(
        wa.aanalyze_weather_on_modal(rides, headings), _ticker()
    )

    assert result == {"ok": True}
    assert seen["args"] == (rides, headings)
    # Ran off the loop thread, with no running loop there.
    assert seen["thread"] is not main_thread
    assert seen["had_loop"] is False
    # The loop stayed responsive for the whole 0.3 s block (10 x 0.05 s).
    assert ticks == 10


def test_scheduler_calls_the_async_wrapper_not_the_sync_dispatch():
    """The wrapper only helps if production actually awaits it.

    The previous test proves the wrapper works; this one proves the weekly
    task uses it. Without this, the scheduler can keep calling the blocking
    sync dispatch and the wrapper test stays green.
    """
    source = SCHEDULER.read_text(encoding="utf-8")
    assert "aanalyze_weather_on_modal" in source
    assert "results = analyze_weather_on_modal(" not in source
