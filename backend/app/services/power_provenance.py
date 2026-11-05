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

* ``services/cycling/tss.py`` — ``np or average_power`` → power-derived TSS, so
  an estimate can carry CTL/ATL/TSB.
* ``tasks/scheduler.py`` weather analysis — passes ``avg_watts`` into the Modal
  regression. An estimate derived partly from heart rate makes HR the common
  cause of both axes, which can manufacture a temperature–power coefficient.
* ``services/conformity.py`` — plan conformity compares planned watts to
  ``np or average_power``.
* ``services/nutrition.py`` — fuel targets scale off the same pair.

None of these is filtered here on purpose. Withholding an estimated ride's TSS
would delete load from the training model for anyone without a meter, which is a
product decision, not a provenance one. This module records the fact so the read
path can label it; the analyses above can opt in one at a time.

``tss_source`` is deliberately untouched. A power-derived TSS still records
``"power"`` when the power was estimated, because changing that vocabulary would
silently change every existing badge. The two columns are meant to be read
together: ``tss_source == "power" and power_provenance == "estimated"`` is the
honest label, and the read path can say "power (est.)" without a migration of
historical rows.
"""

from __future__ import annotations

POWER_MEASURED = "measured"
POWER_ESTIMATED = "estimated"


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

