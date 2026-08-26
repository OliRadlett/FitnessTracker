# Feature 5 — Unified Brief (POC)

> **Status**: Approved (POC) — not started
> **Type**: POC — built isolated; value decision deferred
> **Dependencies**: Feature 3 (insights) for the "top insight" element; otherwise uses existing endpoints
> **Own plan**: this document. Work is discrete — do not bundle with other features.

## Goal

A single "what should I do today?" screen — the morning brief. Built as a **self-contained, portable component on its own route** (`/today`), with zero changes to existing pages. Once it proves value we decide whether it becomes the dashboard landing; if it doesn't, it's dropped cleanly.

## Scope

- New route `/today` rendering the `Brief` component (portable — must not depend on page internals)
- Readiness verdict engine (deterministic) with **visible reasoning**
- Today's plan + weather + top insight of the day

## Brief content

1. **Readiness verdict** — one "train today?" call (green/yellow/red) blending Whoop recovery + CTL/ATL trend + recent lifting volume + sleep debt. Each contributing signal shown explicitly with reasoning ("HRV +8% vs baseline", "sleep debt 2h", "yesterday squat-heavy"). Deterministic rule engine over existing endpoints + Feature 3 insights.
2. **Today's plan** — planned session from the active training plan (focus, exercises, targets) or rest-day note.
3. **Weather** — today's forecast + plain-language note (windy/hot/rain); feeds Feature 6 suggestions.
4. **Top insight of the day** — highest-priority `AthleteInsight` surfaced contextually ("Your power peaks when HRV ≥ baseline — you're +8% today").

## Out of scope

- **Cross-page coherence** (ride→weather+response, goal→projection+blockers) — deferred until after this POC passes.
- Replacing or modifying the existing dashboard.

## Go / No-Go criteria

- **Go** if: you habitually open `/today` first and trust the verdict enough to plan around it (even when you override it — the reasons make it a good coach even when it's wrong).
- **No-Go** if: it's a prettier rehash of the dashboard Today tab with no decision value — then we don't promote it.

## Acceptance

1. `/today` renders verdict + reasons + plan + weather + top insight.
2. Existing pages untouched.
3. Go/no-go review completed.