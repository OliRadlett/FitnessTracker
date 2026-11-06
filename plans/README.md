# FitTrack — Planning index

> Moved out of [`AGENTS.md`](../AGENTS.md) on 2026-11-06. This is the index of
> active programmes and the plans that carry their detail. Plan documents are
> **snapshots of intent at the time they were written**; where a plan and the
> code disagree, the code and its tests are the truth. Update the status line
> here when a programme lands or is abandoned.

## Active programmes

**Routes atlas** — [`routes-atlas-2026-11-05.md`](routes-atlas-2026-11-05.md)
replaces the Routes IA: **Browse** (a map that draws every route as a line, a
shape-led list, one-scroll detail, facet/sort URL state) and **Maintain**
(library health). The list API carries **`RouteSummary.preview_polyline`** — a
display-only ~90-point shape (`polyline_utils.preview_polyline`); the full
polyline stays on `GET /routes/{id}` for GPX/3D/matching. Duplicate scanning is
a **background job** (`services/route_similarity.py`): `POST
/routes/duplicates/refresh` queues it, `GET /routes/duplicates/status` reports
`never/queued/running/ready/failed`, and `GET /routes/duplicates` never scans on
read. Route intelligence: the Komoot surface parser now reads the real
`summary.surfaces` list, so **surface 50/86** (Komoot; OSM map-matching now
carries `surface` tags and fills the gap when the road graph runs) and **terrain
86/86** — Strava writes no elevation profile, so `services/route_elevation.py`
resamples the source activity's altitude stream onto the route; quality is
**86/86**. `services/route_intelligence_refresh.py` backfills profiles,
classifies missing terrain and rescores quality after sync/import (and `POST
/routes/intelligence/refresh`); the composite is effort 40 / terrain 35 /
completeness 25 with popularity and surface as zero-weight context. The detail
shows terrain and surface; the page renders no quality controls. Audit:
[`docs/route-intelligence-audit-2026-11-05.md`](../docs/route-intelligence-audit-2026-11-05.md).
Evidence was captured under `prototype/routes/` (not committed).

**Route courses** — [`route-courses-2026-11-05.md`](route-courses-2026-11-05.md).
The model is **Course → Route → Ride**: `Course` is the identity, `Route` is a
concrete variant (geometry, direction, start/end, provider sources), `Activity`
is the ride. Migration **117** adds `courses` + `routes.course_id` +
`course_link_log` and backfills **one course per existing route** (1:1); it does
not group variants or delete routes. Migration **118** adds
`activities.route_link_status/source/confidence/confirmed_at`; every existing
ride→route link is backfilled **`suggested` + `legacy`** because those links
came from the WIP matcher. Course history/PRs must read `confirmed` only.
Migration **119** stores durable suggestion dismissals; the suggestion query
skips both pair orientations. Grouping is an `UPDATE routes SET course_id`, not
a merge; `merge_routes` stays
for identical variants. The API is `/api/v1/courses` (`GET/POST /`, `GET
/uncoursed`, `GET /suggestions` (review-tier pairs from `route_similarity`), `GET /merge-candidates` (same-name courses below the geometry floor),
group/ungroup under `/{course_id}/routes/{route_id}`, merge
`/{target_id}/merge/{source_id}`, `PATCH /{course_id}` (rename), list dismissed suggestions at
`/suggestions/dismissed`, dismiss/restore a pair at
`/suggestions/{a}/{b}/dismiss`, confirm/reject at
`/ride-links/{activity_id}/...`, manual pickers at `/routes/search` and
`/rides/search`, and a manual confirmed link at `/ride-links/{activity_id}/link`);
the UI is `/courses` (More → Courses),
built on `lib/api/courses.ts`. The 86-route investigation (11 cached pairs,
start-offset collapse, 86 → 79 grouping) lived in `prototype/route-merging/`
(not committed).

**Data-integrity programme** (branch `feature/data-integrity-2026-10`, Waves 0–4
landed). Nine specs in this directory from a re-baselined brainstorm, plus
[`2026-10-01-data-integrity-integration-plan.md`](2026-10-01-data-integrity-integration-plan.md)
for sequencing and the cross-section conflicts. Every one of those specs named a *missing
feature* that turned out to be shipped with a silent correctness defect underneath — import
existed but produced load-invisible rides, offline writes existed but one bad set could
wedge a workout, undo existed but never retracted its announcement. Read the integration
plan first: it decides CSV import and the `exercise→FK` migration (both rejected) and
records that §1 must not ship before §5.

Wave 3 (`UndoLog`, §8) landed the mechanism: `models/undo.py` + `services/undo.py`
(typed per-kind restorers, claim-before-restore, 30-day `expires_at`, daily prune task).
**At Wave 3 it had no HTTP surface and no registered production kind** — `RouteMergeLog` was
deliberately *not* migrated onto it, because that would impose a 30-day expiry on a
working, tested undo. Wave 4 (§1 unified daily verdict) landed `services/today.py`:
five engines composed with a `consensus[]` that reports silence as `available: false`.
**New migrations continue from `120`** — main's head is `119` (`117` courses, `118`
link trust, `119` suggestion dismissals). `096` is `undo_logs`, and this branch was
renumbered **four times** in one sitting because `main` kept claiming the numbers
(pitfall 34). Check `git ls-tree origin/main backend/alembic/versions/` immediately
before renumbering, and again before opening the PR.

**Training page overhaul** — [`training-redesign-plan.md`](training-redesign-plan.md)
(IA + editor) with companion [`training-strength-programming.md`](training-strength-programming.md)
(programming). Removes the Build/Week editor split in favour of **one Plan mode** (instant field
edits + atomic Move/Swap/Add/Delete operations), a plan spine with **Plan · Review · Peaks** modes,
and a **Program matrix** for multi-week strength targets with weight suggestions. **Backend was in
scope throughout, and is shipped**: Phases 0–4 (shell + the one-editor Plan mode, Review, Peaks +
load strip, mobile), companion S1–S4 (progression engine, Program matrix, block tools, coaching
aids), and follow-ons C1–C6 (block/phase model, generation inputs, persisted weekly reviews,
autoregulation, propagation timing, undoable structural ops). Migrations: `099` (S1
`strength_progression`), `101` (C3 plan-review snapshots), `102` (C1 `training_plan_blocks`).
**C1 landed the stored block/phase model**, so the load strip's phase names are now the user's own
blocks instead of derived guesses; **C6 gave `UndoLog` its first HTTP surface** (`/api/v1/undo`)
plus an undoable plan-day delete. Supersedes the *scope* of
[`v3-planning-2026-10-12.md`](v3-planning-2026-10-12.md) (whose V3 widgets are reused;
its prod deploy is still open). The remaining/deferred register is §15 of the redesign plan.

**2026-11 — the surface was rebuilt around coverage.** The redesign above fixed the editor and
left the measuring stick: every phase's acceptance criterion was behavioural, so `PlanSpine` shipped
printing `47/49 · 96%` — a denominator of *authored* days — for a plan whose written content had
stopped nineteen days earlier. [`training-overhaul-2026-11.md`](training-overhaul-2026-11.md)
records the rebuild: **Week · Plan** replaces the four-mode switch, the spine states the plan's
*written extent*, the week is rows (one per session, so two sports on a date never overwrite), and
conformity/adaptive/week-ahead collapse into one reconciled "What should change" panel.
`WeeklyView`, `WeekMasterBar`, `DayCell`, `PlanSpine`, `ModeSwitch`, `LoadStrip`,
`ConformitySummaryCard`, `ConformityTrendCard`, `LintPanel`, `UnplannedStrip` and `WeatherForecast`
are deleted. Two e2e-harness bugs surfaced while verifying it: `playwright.config.ts` reuses port
3000 (`reuseExistingServer`), so it can silently test *another checkout's* build; and the PWA
service worker escapes `page.route()`, so mocked API calls leak to the real backend unless
`serviceWorkers: 'block'`.

**Jev strength-session classification** — three specs. [`jev-strength-session-classification.md`](jev-strength-session-classification.md)
defines the label producer: Jev classifies **every** lifting session (note or not) into three typed axes —
`session_split` (push/pull/legs/upper/lower/full_body), `session_lift` (squat/bench/deadlift/overhead_press/accessory)
and `session_class` (max_strength/volume_hypertrophy/speed_power/technique/accessory_conditioning/deload/test) —
stored on `lifting_sessions` with a deterministic rule fallback and a `taxonomy_version`, best-effort and a
no-op when Jev is unset. The vocabularies are aligned to `TrainingPlanDay.planned_focus` on purpose, so the
split+lift axes cover the whole planned-day vocabulary and **label-level conformance ships in Phase 1**.
[`jev-strength-labels-utilisation.md`](jev-strength-labels-utilisation.md) is what the labels are
*for* (lift coverage, push/pull balance, phase detection, deload adherence, a `today.py` engine).
[`cycling-ride-labels-utilisation.md`](cycling-ride-labels-utilisation.md) is the cycling
counterpart — deliberately leaner and mostly **non-Jev** (the semantic `purpose` tag is already shipped and
unread; the ride-quality axis is deterministic/power-derived).

**Wahoo zone sync** — [`wahoo-zone-sync.md`](wahoo-zone-sync.md). Pushes FTP
into the athlete's Wahoo power zone sets so the ELEMNT colours the live zone against
current boundaries, and pushed structured workouts resolve their %FTP targets against a
current FTP. Exercises `power_zones_read`/`power_zones_write`, requested since the
planned-workout push and unused until now. **Backend landed** (migration 103
`wahoo_zone_sets`, read/push/revert under `/cycling/wahoo-zones`, triggered from the five
FTP write sites, `wahoo_zones` notification) — boundary writes **rescale a set's own
values by the FTP ratio** rather than imposing our zone model, so the sync moves the
anchor and not the athlete's zone shape. **HR zones remain impossible via the API** (no
endpoint, no scope, `user_write` cannot carry THR): the card shows local HR zones
read-only and says so. **App-scoping is settled** (HAWahooligan precedent): the API can
only see sets *we* created, so the feature's value rests on a one-time manual
"assign this set to your cycling profile" step, which the card states plainly. The write
probe also settled that `ftp` alone does not recompute boundaries, so the ratio rescale
is required, not optional.

## Detailed spec plans

Current priority order: [`backlog-2026-09-20.md`](backlog-2026-09-20.md) (Phases 0–5 built; remaining items tracked there). Detailed spec plans: [`lift-video-tracking-v2.md`](lift-video-tracking-v2.md), [`lifting-redesign-plan.md`](lifting-redesign-plan.md) (redesign of `/lifting` page — tabbed IA, session cards, PR timeline, plan integration), [`relive-3d-redesign.md`](relive-3d-redesign.md), [`relive-3d-next-level.md`](relive-3d-next-level.md) (Phases A–D: atmosphere, director, perf, audio shipped; WebGPU/share/montage/AI open), [`v3-planning-2026-10-12.md`](v3-planning-2026-10-12.md) (training page redesign — V2.1 emoji pass shipped in `33a86e9`; V3.0 weekly master bar + `DayCell`/`ConformitySummaryCard`/`PlanGoalsStrip` shipped in `520edff`; missed-day quick-actions popover shipped in `cf18415`; deployed via #350 and since superseded by Week · Plan), [`route-matching-phase2.md`](route-matching-phase2.md), [`route-laps-and-variants.md`](route-laps-and-variants.md), [`routes-atlas-2026-11-05.md`](routes-atlas-2026-11-05.md) (Routes Browse/Maintain rewrite — `preview_polyline`, background duplicate scan), [`jev-implementation-plan-2026-09-27.md`](jev-implementation-plan-2026-09-27.md), [`wahoo-planned-workout-push.md`](wahoo-planned-workout-push.md), [`underdeveloped-features-2026-09-27.md`](underdeveloped-features-2026-09-27.md), [`training-aid-review.md`](training-aid-review.md), [`training-redesign-plan.md`](training-redesign-plan.md) (training page overhaul — plan spine + one Plan-mode editor; supersedes the `v3-planning` surface scope), [`training-strength-programming.md`](training-strength-programming.md) (companion — multi-week strength targets + weight suggestions).

## Archive

Finished and superseded plans stay in this directory so their decisions and
measurements remain searchable; `archive-README.md` explains the convention.
Do not treat an archived plan's status line as current.
