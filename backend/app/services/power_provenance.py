"""Power provenance — did a device measure these watts, or did the provider guess?

``Activity.average_power`` / ``normalized_power`` / ``max_power`` arrive inside a
provider payload, and that payload does not say how the number was produced
unless you look. Strava's activity summary carries ``device_watts``: ``true``
means a power meter or smart trainer recorded the channel, ``false`` means
Strava *estimated* it from heart rate, speed and bodyweight.

That distinction was invisible everywhere downstream. A ride with no meter got
an estimated ``average_watts``, which then fed an all-time power PR, a W/kg
figure and a power-derived TSS — each badged as measured, because nothing in
the pipeline could tell the difference.

Why ``power_provenance`` and not ``power_source``: ``tss_source`` already uses
the value ``"power"`` on its own axis, and ``power_models`` returns
``maximal_power_source``. Three different senses of "source" in one codebase is
one too many, and `grep power_source` would land on a VO2max diagnostic.

Values
------
``measured``
    A device recorded the watts: Strava ``device_watts: true``, or a FIT import
    (a FIT file has no way to carry a Strava-style estimate, so its power field
    is always device-recorded).
``estimated``
    The provider inferred them: Strava ``device_watts: false``.
``NULL``
    Unknown — a non-power activity, a payload that did not say, or a row written
    before this column existed.

Every consumer must **fail open on NULL**. Excluding unknowns would silently
drop a real ride from a PR curve, which is the worse error: the column exists to
withhold trust from watts we *know* were guessed, not to require proof for watts
we simply have not classified.

Where the estimate actually reaches analysis (checked, not assumed)
------------------------------------------------------------------
*Every* stream-derived figure is already immune: an estimated ride has no
``watts`` stream, and the power curve, CP/W'/Pmax fit, decoupling, zone
distribution and PR detection all read streams. The exposure is the *summary*
columns, which four analyses consume directly:

* ``tasks/scheduler.py`` weather correlation — **filtered** via
  :func:`measured_power_clause`. It is the one case where an estimate fabricates
  signal rather than merely adding noise: the estimate is derived partly from
  heart rate, and heart rate rises with heat, so the fit sees HR on both axes and
  can manufacture a temperature–power coefficient.
* ``services/cycling/tss.py`` — ``np or average_power`` → power-derived TSS, so
  an estimate can carry CTL/ATL/TSB.
* ``services/conformity.py`` — plan conformity compares planned watts to
  ``np or average_power``.
* ``services/nutrition.py`` — fuel targets scale off the same pair.

The last three are deliberately **not** filtered, and the reason is history
rather than principle. TSS is stored per activity and feeds CTL/ATL: changing
the rule only for newly synced rides would leave one load series built from two
different models, and recomputing the old rows would rewrite training history to
correct a second-order accuracy issue. hrTSS is not obviously the better number
either — it is a coarse %HRR model, and swapping a reasonable estimate for a
coarser one is not a clear win. So the number stays and the label carries the
truth: ``tss_source == "power"`` with ``power_provenance == "estimated"`` reads
as "power (est.)". Conformity and fuel inherit the same stance for consistency
with the load they sit on.
"""

from __future__ import annotations

from sqlalchemy import ColumnElement

from app.models.activity import Activity

POWER_MEASURED = "measured"
POWER_ESTIMATED = "estimated"


def measured_power_clause() -> ColumnElement[bool]:
    """SQL predicate: this activity's summary power may be treated as measured.

    NULL-safe **by construction** — ``IS DISTINCT FROM`` rather than ``!=``.
    A plain ``power_provenance != 'estimated'`` evaluates to NULL for an
    unclassified row, and NULL is not true, so the row would be dropped: exactly
    the fail-closed behaviour the module docstring forbids. Rows written before
    migration 107 are unclassified, not estimated.

    Used by the weather-correlation sample (``tasks/scheduler.py``), which is the
    one analysis where an estimate actively fabricates signal: the estimate is
    derived partly from heart rate, and heart rate rises with heat, so including
    estimated rides puts HR on both sides of the regression and can manufacture
    a temperature–power coefficient.

    Deliberately **not** applied to TSS. See the module docstring: excluding an
    estimate's load would delete CTL/ATL history for anyone without a meter.
    """
    return Activity.power_provenance.is_distinct_from(POWER_ESTIMATED)


def from_strava_payload(payload: dict) -> str | None:
    """Classify the power channel of a Strava activity summary.

    Returns ``None`` — "unknown", not "estimated" — when the payload cannot
    answer, so a caller never withholds trust it has no evidence for:

    * no ``average_watts`` → the ride has no power channel at all, whatever
      ``device_watts`` says. Strava returns ``device_watts: false`` for runs and
      for rides without a meter and without an estimate, so the flag alone is
      not sufficient evidence of a guessed number.
    * no ``device_watts`` key → an older or partial payload; unknown.
    """
    if payload.get("average_watts") is None:
        return None
    device_watts = payload.get("device_watts")
    if device_watts is None:
        return None
    return POWER_MEASURED if device_watts else POWER_ESTIMATED

