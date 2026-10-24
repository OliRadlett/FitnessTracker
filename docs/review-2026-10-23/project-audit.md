# FitTrack project audit

**Date:** 2026-10-23  
**Scope:** bugs, security, data integrity, scientific validity, maintainability, and enhancements  
**Method:** read-only source review, current documentation review, and comparison with the existing science audit

This audit records findings from the current worktree. It does not claim that an item is fixed unless the source or a test proves it.

## Confirmed defects

| Priority | Finding | Evidence | User or operator impact |
|---|---|---|---|
| P0 | Route-map popups insert `route.name` into HTML without escaping. | `frontend/src/components/routes/RoutesMapView.tsx:160-165` | A provider or imported route name can inject markup or script into an authenticated session. |
| P0 | Production startup continues after an Alembic failure. | `backend/app/main.py:31-50` | The API can serve against an incomplete schema after a failed migration. |
| P0 | Real credentials remain in the working-tree `.env`. | `docs/BUGS.md:25-29` | Gitignored files can still leak through backups, shared machines, shell history, or uploads. |
| P1 | OAuth user lookup is case-sensitive although allowlisting is case-insensitive. | `backend/app/api/auth.py:81` (was `:74-91`) | ⚠️ **Resolved** — `sync_user` now normalizes `body.email` to lowercase before lookup and storage, matching the case-insensitive allowlist. Regression test: `backend/tests/integration/test_sync_user_email_norm.py`. |
| P1 | Event tapering is not idempotent. | `backend/app/services/training_plan.py:947-983` | Re-linking an event can multiply taper reductions and silently shrink planned load. |
| P1 | Orphan-route quarantine has no producer. | `backend/app/services/route_quarantine.py:258-285` | The orphan review UI remains empty and route residue is never quarantined. |
| P1 | Wahoo route sync never increments `merged_count`. | `backend/app/services/wahoo.py:426-550` | Sync summaries and operational metrics report false results. |
| P1 | Whoop weigh-ins use the server date. | `backend/app/services/whoop.py:1291-1308` | Weigh-ins near midnight can land on the wrong user calendar day. |
| P1 | Route matching uses the same degree-to-metre cell width for latitude and longitude. | `backend/app/services/route_matching.py:260-279,338-349` | Candidate routes can be missed at higher latitudes, including the UK. |

The following defects are recorded elsewhere and still need a fix or a live reproduction.

- `BUG-068` remains open for fuel-plan loading. See `docs/BUGS.md:37-41`.
- Live-session flushing may abandon the remaining queue after one failed set. See `plans/weak-areas-remediation-2026-09-26.md`.
- Non-404 live-session HTTP errors may remain retryable forever. See the same plan.
- Replay race markers may become positionally misaligned after rides are filtered. See the same plan.

## Scientific validity risks

These are not all software bugs. They can still make advice or comparisons misleading.

1. Decoupling uses arithmetic mean power instead of normalized power in `backend/app/services/cycling/vo2max.py:387-452`.
2. Decoupling has no single-activity duration, steady-state, variability-index, or aerobic-zone validity gate.
3. Decoupling halves are split by sample count rather than elapsed time, so missing samples can bias the comparison.
4. VO2max bands in `backend/app/services/cycling/vo2max.py:52-80` are presented as general-population bands without age or sex adjustment, and the scope caveat is not surfaced in the response.
5. Climb categories in `backend/app/services/segments.py:143-155` are called Strava-style but do not implement Strava's climb-score thresholds.
6. LTHR zones in `backend/app/services/cycling/zones.py:34-41` are attributed to Coggan even though the boundaries match neither the cited Coggan table nor a clearly named alternative.
7. TSB is stored after applying the current day's TSS in `backend/app/services/cycling/training_load.py:62-82`. Readiness surfaces must state whether the value is morning or post-session form.
8. The lifting load metric is a bespoke bodyweight-normalized volume metric, not Foster's session-RPE method. The attribution in `backend/app/services/lifting.py` should be corrected.
9. Fuel guidance in `backend/app/services/nutrition.py:43-50` needs a clearer, evidence-based explanation of carbohydrate ratios above 90 g per hour.
10. Adaptive CTL and ATL time constants are selected by maximizing correlation with HRV. This is exploratory and may overfit a single athlete's history.

The detailed evidence and literature references remain in `docs/review-2026-10-15/science-review.md`.

## Maintainability and reliability

- `frontend/src/lib/api/types/generated.ts` is generated but unimported. The application still relies on hand-maintained client types, so API drift can pass unnoticed.
- End-to-end tests are not yet a blocking signal for the important mutation flows. Prioritize live lifting, imports, route operations, deep links, and account actions.
- `Replay3D.tsx` is approximately 2,000 lines. Extract the scene, terrain, and camera responsibilities before adding more replay features.
- Several CODEMAP and planning files describe removed or unwired features as active. Treat the code as authoritative and refresh the maps.
- Activity-to-lifting linking performs per-activity matching work in `backend/app/services/strava/linking.py:251-276`. Batch the candidate data before scaling the backfill.

## Recommended enhancements

1. Add a data-health page that shows stale providers, missing streams, weak model confidence, and the next input that would improve advice.
2. Add a short subjective wellness check-in for users without Whoop data.
3. Decide whether `/today` becomes a supported daily workflow or remains an experiment. See `plans/feature5.md`.
4. Forecast injury risk against planned load, not only historical load.
5. Add a cross-route climb identity key and a global climb leaderboard.
6. Add a course simulator using route elevation, power models, weather, and pacing.
7. Add an attention inbox that combines alerts, notifications, insights, and recommendations.
8. Show per-user AI usage and cost in settings.
9. Add a post-race retrospective that compares plan, actual effort, TSB, weather, and result.

## Suggested delivery order

1. Rotate credentials and remove the XSS sink.
2. Make migration failure stop startup and normalize OAuth email identity.
3. Fix taper idempotency, timezone dates, Wahoo accounting, and route-grid geometry.
4. Correct the decoupling, TSB, VO2max, climb, HR-zone, and nutrition semantics.
5. Choose one frontend API type source and make mutation E2E tests blocking.
6. Build data-health and planned-load surfaces before adding more automated coaching.
