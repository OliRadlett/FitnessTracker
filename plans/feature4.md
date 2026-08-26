# Feature 4 — Health Page (POC)

> **Status**: Approved (POC) — not started
> **Type**: POC — likely to become a core domain page
> **Dependencies**: Feature 2 (sleep cards) — this page consolidates and supersedes the dashboard-only placement
> **Own plan**: this document. Work is discrete — do not bundle with other features.

## Goal

Give health/recovery data a dedicated home matching the domain-page pattern (like Cycling and Lifting). Consolidates currently-scattered data — readiness, recovery/HRV, sleep intelligence, respiratory rate, weight trend, health alerts — into one coherent page, while the dashboard keeps its summary widgets.

## Scope

- New **Health** sidebar page (`/health`)
- Sections: Readiness (existing `GET /metrics/readiness`), Recovery/HRV trend (charts), Sleep intelligence (Feature 2 cards, full-width), Respiratory rate, Weight trend, Health alerts (list + dismiss + run-analysis)
- Drill-down from dashboard cards → `/health`
- Reuse existing endpoints + chart registry; minimal new backend

## POC framing

This is primarily a **UI consolidation** exercise — little new computation. Its value is judged on whether one home for health data is genuinely better than the current scattered widgets, and whether it earns a permanent sidebar slot.

## Go / No-Go criteria

- **Go** if: you use `/health` as your primary recovery/sleep/alert destination for 2+ weeks and the dashboard widgets stay non-redundant (cards link in, don't duplicate everything).
- **No-Go** if: it feels like a re-arrangement of the same widgets with no added utility — then keep the Feature 2 dashboard cards and skip the page.

## Acceptance

1. `/health` renders all sections with real data; links from dashboard cards work.
2. Feature 2 cards remain functional on the dashboard.
3. Go/no-go review completed.