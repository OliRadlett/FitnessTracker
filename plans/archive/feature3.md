# Feature 3 — Correlation Engine + Analytics Page (POC)

> **Status**: Approved (POC) — not started
> **Type**: POC — has explicit go/no-go; drop cleanly without cascading
> **Dependencies**: none strictly; feeds Feature 5 (brief) and Feature 6 (prescriptions)
> **Own plan**: this document. Work is discrete — do not bundle with other features.

## Goal

Turn the platform's unique asset — years of Whoop recovery/sleep alongside cycling power and lifting volume — into **deterministic, observed** cross-domain insights. A per-user "athlete model" of observed coefficients (never fitted/generic), surfaced on a new **Analytics** page with drill-down. Everything is a formula over your data; correlations are labelled as associations, never causation.

## Scope

- New `analytics/` service package with six deterministic insight functions
- `AthleteInsight` model + migration; nightly Celery compute task + on-demand recompute endpoint
- `GET /api/v1/analytics/insights` API
- New **Analytics** page (sidebar item) with cards + drill-down tables
- Minimum-sample guards: an insight only displays above N samples, else "collecting data…"

## The Six Insights

1. **Recovery cost per session type** — HRV/recovery delta (vs 14-day baseline) in the 48h after each session, bucketed by sport / IF / TSS band / lifting focus+volume → "Squat ≥10k kg costs ~6 HRV points for 2 days."
2. **Sleep → performance** — power (NP/IF) and RPE-vs-planned by prior-night sleep band (<6 / 6–7 / 7+ h).
3. **Load composition → readiness** — weekly strength-vs-endurance split vs that week's recovery (12–16 wk window).
4. **Context power norms** — NP vs temperature/wind bands from tagged weather ("best power: 12–18°C").
5. **PR-outcome clustering** — PR events vs prior-week HRV/recovery/sleep/TSB ("3 of 4 PRs after HRV ≥ baseline").
6. **Personal TSB peak band** — NP relative to FTP vs TSB bucket (also feeds Feature 6).

## Design decisions

- **Storage**: nightly Celery task computes insights into `AthleteInsight` (`type`, `period`, `data` JSONB, `sample_size`, `computed_at`) + on-demand `POST /analytics/recompute`. Frontend reads the table — fast, always-fresh source for the Feature 5 brief.
- **Determinism**: simple mean/median deltas + Pearson where sensible, with explicit minimum-N and confidence heuristics. No model fitting (Feature decision: observed coefficients, not adaptive models).
- **Per-user**: every coefficient stored per `user_id` from day one.

## Go / No-Go criteria (evaluated together after a working build)

- **Go** if: on real data, at least the recovery-cost (#1) and sleep→performance (#2) insights produce stable, plausible output that you find genuinely actionable ("yes, that matches what I feel").
- **No-Go** if: outputs are noisy/unstable at our sample sizes, or feel like noise not signal. Drop the page and insights; brief (Feature 5) then relies on the simpler readiness blend only.

## Acceptance

1. Six insights render with real data; min-sample guards visibly work.
2. Nightly task runs; recompute endpoint works; `AthleteInsight` history accumulates.
3. Go/no-go review completed against the criteria above.