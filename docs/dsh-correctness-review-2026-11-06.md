# Documentation correctness review — 2026-11-06

Line-by-line review of the current-state documentation against the code, plus a
status audit of all 71 plan documents. This is the deep pass the first audit
deferred; it is **not** a style review.

## Method

- **Read line by line**: `AGENTS.md`, `docs/DSH.md`, `docs/RUNNING.md`,
  `docs/PITFALLS.md`, `docs/algorithms.md`, `docs/DEPLOY.md`, `docs/BUGS.md`,
  `docs/BUGS-archive.md`, `docs/ANDROID-AUTH.md`, `docs/JEV_TAGGING.md`,
  `docs/R2_SETUP.md`, `docs/review-vs-act.md`,
  `docs/route-intelligence-audit-2026-11-05.md`, `README.md`, `plans/README.md`,
  `.dsh/README.md`, and the three project skills that encode repo conventions.
- **CODEMAPs**: three independent read-throughs (frontend; services;
  api/models/schemas), each verified against routers, models, schemas, exports
  and tests. Findings were re-checked before applying.
- **Plans**: status claims only, verified with `git merge-base --is-ancestor`,
  `git ls-tree origin/main|origin/prod`, migration files and code existence.
- **Mechanical sweep**: 4,337 backticked path/line claims extracted from 265
  Markdown files; current-state misses triaged (the 11 remaining are uncommitted
  QA images or server-only paths).
- **Not** line-audited: `docs/OPENCODE.md` (legacy tooling, not repo claims),
  `docs/archive/*`, `docs/review-2026-*` (historical), third-party skill bodies
  (`graphify`, `impeccable`).

## Result summary

| Area | Discrepancies | Fixed | Deferred |
|---|---|---|---|
| Frontend CODEMAP | 27 (12 HIGH, 9 MED, 6 LOW) | 27 | 0 |
| Services CODEMAP | 6 (1 HIGH, 1 MED, 4 LOW) | 6 | 0 |
| API/models/schemas CODEMAPs | 15 (2 HIGH, 5 MED, 8 LOW) | 15 | 0 |
| Plan statuses (71 plans) | 18 stale + 2 unverified + 8 unstated | 28 status lines | 0 |
| Narrative docs | 14 | 14 | 0 |
| Pitfalls | 3 | 3 | 0 |
| Rot guards | 3 new tests | 3 | 0 |

## The highest-impact errors

1. **JWT lifetime was wrong in `AGENTS.md`** — it said 7 days; `ACCESS_TOKEN_EXPIRE_MINUTES`
   is `60 * 24 * 30` (30 days). Fixed to 30 days.
2. **The chart registry was described as 43 charts, with five that do not exist
   and eight that were missing.** `CHART_REGISTRY` has **46** keys; `form`,
   `velocity`, `consistency`, `bar_path` and `sticking_point` are not registered,
   while `session_class_mix`, `lift_frequency`, `pr_cadence_by_lift`, `ride_mix`,
   `big_3_total`, `rep_range_distribution`, `volume_intensity_periodization` and
   `rpe_drift` are. Fixed in `docs/algorithms.md`.
3. **The route embedding was described as 42-dim.** `route_embedding.py` sums to
   **41** (8 + 16 + 8 + 5 + 4). Fixed in both `docs/algorithms.md` and the
   services CODEMAP.
4. **Three "open" bugs were already fixed.**
   - BUG-025: the settings page now calls `/auth/oauth/{provider}/connect-state`
     and redirects to a backend-built `authorize_url` (the code comment names
     BUG-025).
   - BUG-048: the Caddyfile now uses `email {$ACME_EMAIL:o.radlett@gmail.com}`
     (fixed in `64b73856`).
   - BUG-068: `tests/integration/test_nutrition_api.py` pins 200/null and
     200/plan; the endpoint returns `RideFuelPlanRead | None`.
   Moved to `docs/BUGS-archive.md`; the active tracker now says **Open: 2**.
5. **The bug counts were arithmetically wrong.** The header claimed 99 tracked /
   84 fixed / 5 open; the files document 61 archived + 2 open. IDs are
   non-contiguous (014–044 and others were never filed), so both files now say
   that explicitly instead of implying a total.
6. **`docs/ANDROID-AUTH.md` said "there is no sync yet".** History sync has
   shipped (`GET /lifting/sessions` on sign-in, `POST /lifting/sessions` on
   finish). Corrected, and the missing `docs/GCP-AUDIT.md` reference was
   replaced with the fact that the audit was local/uncommitted.
7. **`README.md` described the old dashboard** ("Today / Weekly / Monthly
   tabs"). The page is Today / Trends / History (`?view=`), with legacy `?tab=`
   mapped. Also removed the "Suggested Training Cycle" bullet: `SuggestedCycleResponse`
   is defined but has no endpoint or UI, and corrected the decoupling gate
   (≥20 min single activity, ≥60 min history) and route-linking wording
   (course suggestions + confirmed links).
8. **`frontend/src/CODEMAP.md` called `lib/api/cycling.ts` deleted.** The file
   is live with four functions used by Settings. It also documented six
   components that no longer exist (`TodayAdaptiveAction`, `GoalsSection`,
   `CrossDomainInsightsCard`, `WeeklyView`, `AdaptiveSuggestionsCard`,
   `WeatherForecast`) and put `SessionRow`/`SessionGlyph`/`WeekSection`/
   `RouteShape`/`StreamChart` in the wrong directories. Fixed the paths and
   removed/replaced the dead rows.
9. **`review-vs-act.md` referenced `SetsVisualizer` twice.** Both the component
   and `sets-visualizer.test.ts` are gone; `SetLadder` (with its "Set review"
   label) is the current set view. Fixed.
10. **`docs/algorithms.md` overstated route auto-merge.** 0.82 tiers a pair for
    review; `route_auto_merge_enabled=False`, so nothing merges automatically.
    The row now says so.

## Full findings

### Narrative docs (all fixed)

| Doc | Finding | Fix |
|---|---|---|
| `AGENTS.md` | JWT 7-day; pitfall 27 said neither workflow has `workflow_dispatch` (both do) | 30-day; pitfall reworded as a keep-it guard |
| `docs/PITFALLS.md` | #6 cited `003_add_pr_notes.py` carrying revision 004 — it was renamed to `004_add_pr_notes.py`; #27 stale | Both reworded with the historical fact |
| `docs/algorithms.md` | 43→46 charts + list; 42→41 dims; auto-merge; embedding breakdown | Corrected |
| `docs/BUGS.md` | 99/84/5 counts; BUG-025/048/068 stale | Counts reconciled; three bugs archived |
| `docs/BUGS-archive.md` | "98 total / 82 fixed" contradicted its 58 rows | 61 archived; three new rows |
| `docs/ANDROID-AUTH.md` | "no sync yet"; missing `docs/GCP-AUDIT.md`; "until released" time-bound | Sync described; audit noted as uncommitted; conditional |
| `docs/DEPLOY.md` | Auth line refs pointed at the wrong lines; `/api/v1/*` claimed all-JWT | `auth.ts:91`, `auth.py:79`; auth bridge/webhooks exceptions documented |
| `docs/route-intelligence-audit` | Before/after snapshot read as current; `scripts/osm_bootstrap.py` path; evidence scripts uncommitted | Historical banner; `python -m app.scripts.osm_bootstrap`; evidence note |
| `docs/review-vs-act.md` | `SetsVisualizer` gone | `SetLadder` |
| `README.md` | Dashboard tabs; dead Suggested Cycle; decoupling gate; route matching | Corrected |
| `plans/README.md` | v3 "prod deploy still open" | Deployed via #350, superseded |

### Frontend CODEMAP (23/27 fixed)

- Dashboard row rewritten for Today/Trends/History; dashboard query count 16→23.
- Removed `TodayAdaptiveAction`, `GoalsSection`, `CrossDomainInsightsCard`,
  `AdaptiveSuggestionsCard`, `WeatherForecast`; `WeeklyView` row marked historical.
- `cycling.ts` un-deleted and added to the client table.
- `useAiAnalysis` no longer claims a nonexistent `/analysis/{domain}/{id}` route.
- Health header (`SyncLine`, not `LoadStrip`/`SyncBadge`), `WeightCard` link
  (`/settings`, not `/cycling`).
- Notifications: link to Settings, not a `/notifications/preferences` panel.
- Mode shell marked retired; mobile labels corrected to Dashboard/Cycling/Train/
  Plan/More; time-range adoption corrected to health + analytics.
- Paths fixed: `lifting/PerArmHint`, `maps/compareMapStyles.ts`,
  `segments/ClimbProfile`, `journal/*`, `activity/*`.
- `WahooPushModal` trigger now `training/week/WeekSurface`.

### Services CODEMAP (6/6 fixed)

`gpx.py` (`route_to_gpx`/`activity_to_gpx`, not `generate_gpx`), 41-dim,
46 charts, 13 of 14 registry metrics (`lift_sessions` unsupported),
`/plans/{plan_id}/week/{week_number}`, `/dashboard/today`.

### API/models/schemas CODEMAPs (11/15 fixed)

- `LinkActivity` → `LiftingSessionLink`; `VolumeTrend`/`TrainingLoad`/`PowerCurve`/
  `PowerZones` → exact `*Response` names.
- `LiftVideoAnalysis` is per `(user, exercise_name)`, not per video; `analysis_depth`
  is an argument.
- `SegmentGroup` migration 106→108; `StravaWebhookEvent` 005→037.
- Notification types 12→13 (`plan_review`).
- TSB projection event is optional (no 400); `/merged-view` is `/{route_id}/merged-view`.
- `RouteMergeLog` is destructive-but-undoable; quality runs weekly; `TrainingPlanBlock` added.

### Plan statuses (20 corrected)

Shipped/merged (was "on a branch / not deployed"): routes atlas, route courses,
cycling page, Wahoo zone sync, calendar, route matching phase 2, route merging
phase 2, lifting overhaul, training redesign, multi-sport days, relive 3D
production, Jev implementation/classification/labels/decision layer, training
plan mode (implemented then superseded), v3 planning (deployed then superseded),
ride/course split (superseded by the Course model). `relive-3d-next-level` is
marked **unverified/superseded** because its branch is not an ancestor of `main`.

## Remaining known issues

- **One false-positive link** remains in the repo-wide checker: a Python regex
  literal in `.superpowers/.../task-1-brief.md` that looks like a Markdown link.
  It is session scratch, not a doc.
- `docs/OPENCODE.md` remains a legacy tooling guide; its claims were not audited
  because they describe OpenCode, not FitTrack. The `.opencode/` tree is kept
  (decision: do not retire it without the owner's call) and the DSH↔OpenCode
  skill-coverage guard still protects the shared skills.
- `docs/archive/*` and `docs/review-2026-*` are historical and were not
  re-litigated.

## Verification

```text
python -m pytest backend/tests/test_doc_claims.py backend/tests/test_agent_docs.py -q
14 passed
```

- `AGENTS.md` is 22,387 B (budget 24 KB).
- Repo-wide link check: **1** hit, the regex-literal false positive above.
- Every corrected claim above was checked against the named code or git object.
- Three new guards now pin the claims that rotted: the chart count/list, the
  route-embedding dimension, and the bug-tracker counts.

## Concurrent-session note

Another session is still modifying `.dsh/plugins/feature-quality/*` and
`.gitignore`. Those files are not part of this review and were left untouched.
No files were committed.
