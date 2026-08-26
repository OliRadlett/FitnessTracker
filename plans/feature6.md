# Feature 6 — Prescriptions (POC)

> **Status**: Approved (POC) — not started
> **Type**: POC — deterministic coaching layer
> **Dependencies**: Feature 3 (insights) + Feature 5 (verdict engine)
> **Own plan**: this document. Work is discrete — do not bundle with other features.

## Goal

Deterministic, explainable coaching recommendations built on the correlation engine and brief verdict engine. Never black-box; every suggestion shows its inputs.

## Scope

1. **Next-session suggestion** — reuses the brief's verdict engine phrased as a suggestion: "Z2 90 min, flat route (windy) — or indoor; cut volume 15% on the sleep debt." Surfaced on the `/today` brief and cycling page.
2. **Strength autoregulation** — per-exercise suggested working weight from last-session RPE/e1RM trend (RPE ≤7 → +2.5 kg, RPE ≥9 → hold/drop). Surfaced on the **lifting page + training plan view**. Live Lift stays pure logging (decision).
3. **What-if projections** — interactive scenario over the existing `projections.py` metric-trend: "hold 300 TSS/wk → 320W FTP in ~10 wks." Applied to **all four** metrics (FTP, 1RM, weight, VO2max), complementing Feature 2's read-only lines.

## Out of scope

- Adjusting Live Lift logging behaviour.
- Any machine-learning/adaptive model (deterministic rules only).

## Go / No-Go criteria

- **Go** if: the suggestions are correct/useful often enough that you act on some of them (a miss with visible reasoning is fine).
- **No-Go** if: suggestions are noise you habitually ignore — drop the coaching layer, keep the analytics.

## Acceptance

1. All three prescriptions render with visible inputs/reasoning.
2. Autoregulation hint on lifting page + training plan view.
3. What-if works for all four metrics.
4. Go/no-go review completed.