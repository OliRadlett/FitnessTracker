# FitTrack — Future Enhancements, Improvements & Features

> **Date**: 2026-09-06 · **Status**: In progress — Phase A §2.1–2.3 done (dead-client sweep, sidebar/nav fixes, minor correctness); unstarted §0.2, §1.1–1.4, Part 3+.
> **Scope**: Everything below **except** new OAuth integrations (Garmin/TrainingPeaks/Zwift/Apple Health) and full nutrition tracking — both deliberately excluded per request.
>
> **Source**: Fresh audit of the codebase (backend services/APIs, frontend pages/components, docs, CI) on 2026-09-06, cross-referenced with existing plans (`roadmap-2026-08.md`, `routes-redesign.md`, `phase-7.md`, `health-monitor-tuning.md`, `misc-features-and-fixes.md`, `cohesiveness-2026-08-26.md`), `docs/BUGS.md`, and `plans/issues.md`.
>
> **Verified-already-done** (not re-planned here): health-monitor tuning (13 changes live), Komoot v007 rework (Basic Auth fallback + coordinates + surface), PDF/CSV data export (surfaced in UI), 13 Playwright E2E specs, orphans `SuggestedCycleCard`/`SkeletonCard`/`SkeletonChart` (deleted — docs stale only).

**Priority legend**: `P0` ship-blocker / baseline hygiene · `P1` high value, low risk · `P2` moderate · `P3` nice-to-have/long-horizon. Effort: `XS` <0.5d · `S` ≤1d · `M` ≤3d · `L` ≤1w · `XL` >1w.

---

## Part 0 — Baseline hygiene (P0)

### 0.1 Land the in-flight working tree
`main` is ~10 commits ahead of `origin/main` **and** the working tree carries 24 modified/untracked files (live-lift E1–E8 hardening, routes heatmap + merged-view, PWA-update banner, `scripts/setup-wsl-docker.sh`). All new feature branches diverge from this.
- [ ] Commit/PR the live-lift hardening + routes heatmap/merged-view work; publish `main`; then merge `main`→`prod` per the release process.
- [ ] Note: `plans/live-lift-hardening.md` already documents the E1–E8 round — keep it in sync with whatever actually ships.

### 0.2 Reconcile stale documentation (separately runnable, tiny commits)
| Doc | Stale facts | Fix |
|-----|------------|-----|
| `frontend/src/CODEMAP.md` | ~25 phantom function names (`fetch*` era), mis-attributed modules (`getEventAiAnalysis` in events row), PWA line "network-first API GETs with cache fallback" (SW is **network-only** for `/api/v1/`), orphan note claims `SuggestedCycleCard`/`skeleton` files exist (they're deleted) | Rewrite the API-client table to actual exports; fix PWA description |
| `frontend/src/lib/api/CODEMAP.md` | Same phantom names, `getFtpHistoryEntry` doesn't exist, wrong module attribution | Same sweep |
| `AGENTS.md` | Celery table omits `compute-route-quality-scores` (weekly Sun 3AM); `cleanup_old_data` row misses the new orphaned-live-session auto-close (E5) | Add rows/notes |
| `docs/algorithms.md` | Reads like a Phase-5 snapshot. Undocumented but implemented: health composite scoring, FTP multi-method estimation + confidence, sleep intelligence (readiness/consistency/debt/bedtime), goal projections (OLS/badges/TSB), deficiency analysis, effort estimation, route quality scoring, nutrition fuel plans, HR/LTHR zones, HR-TSS/VI/VAM | Expand to a full algorithm inventory (one line each) |
| `frontend/src/CODEMAP.md` routes section | Two duplicate `routes/` component blocks + `CompareRoutesModal` listed twice | Merge |

**Decision needed (recorded for Part 2): the whole CODEMAP cleanup is folded into the dead-client cleanup (§2.1).**

---

## Part 1 — Already-planned, still open (highest fidelity)

### 1.1 Strength video system — Phase 9 spec (L)
Fully specced in `plans/roadmap-2026-08.md`, zero code exists (no `LiftVideo`, no R2/S3/presigned anywhere).
- [ ] Cloudflare R2 presigned PUT (≤250MB, mp4/quicktime/webm), presigned GET stream URLs, `LiftVideo` model (migration 030 design), graceful 501 without S3 creds.
- [ ] `POST /lifting/videos/upload-url`, `POST /lifting/videos`, `GET /lifting/videos/{id}/stream-url`; URL-only mode (YouTube/Vimeo embed + link cards).
- [ ] `VideoEmbed` component, per-session + per-PR chips, `/videos` Video Bank page with exercise/date/source filters.
- **Skips cleanly**: no S3 config → upload returns 501; URL mode still works.

### 1.2 Activities page Phase B — `?include_context=true` (M)
Deferred pending performance testing in Phase 8A. Bulk-list activity enrichment (zones, decoupling, load position, linked route/session summaries) without N+1.
- [ ] Profile the current list endpoint, then add the include-context path with eager-loaded relations and a single summary-fetch pass.

### 1.3 Post-sync background activity analysis (M)
AGENTS.md "Planned/Incomplete": a Celery task that computes activity context (zone time, decoupling, load position, effort metrics) **at sync time** instead of on-demand chart reads.
- [ ] New `compute_activity_context(activity_id)` service + hook into Strava/Wahoo sync; store on `Activity` or `ActivitySource` (`context` JSONB).
- [ ] Long-term: makes list views/detail instant without per-call computation.

### 1.4 Deferred bug backlog (mostly architecture, do with care)
| Ref | Item | Evidence | Effort | Risk |
|-----|------|----------|--------|------|
| BUG-015 | **Double-commit anti-pattern** — `get_db()` auto-commits + **35 explicit `await db.commit()` in 8 API files** | `backend/app/api` | M | HIGH — do per-file with test gate, never bulk |
| BUG-025 | **OAuth `redirect_uri` built client-side** → backend should return it in the authorize response | `settings/page.tsx:78-83`, `api/auth.py` | M | MED — touches all providers |
| BUG-040 | **`WeeklyTabProps` has 35 props** (1 declared-but-unused: `sessions`) | `components/dashboard/WeeklyTab.tsx:37-72` | S | LOW |
| BUG-041 | **~200 lines duplicated monthly/yearly rendering** between `WeeklyTab`/`MonthlyTab` | both files | M | LOW |
| BUG-045 | **Live secrets in `.env`** (Komoot pwd, Gemini key, SECRET_KEY) — rotate, use secrets manager | `.env` | XS (manual) | ops |
| BUG-048 | **Deploy Caddyfile placeholder ACME email** `admin@example.com` | `.github/workflows/deploy.yml` | XS | ops |

---

## Part 2 — Frontend code-health & cleanup (P1)

### 2.1 Dead API-client inventory + strategic fork (L)
**Audited: 100 of 146 exported functions (~477 lines) across 16 `lib/api/*` modules are never imported**; 8 modules are fully dead (`activities`, `cycling`, `dashboard`, `nutrition`, `events`, `llmAnalysis`, + `auth`, `workoutPlanner`). Pages drift to inline `authFetch<T>('/api/v1/...')`. This is a **fork, not a chore** — decide one:
- **Option A — delete the dead clients** (embraces inline-fetch reality; removes ~500 lines + the CODEMAP drift). Cheapest, but abandons the documented convention ("add a client in `lib/api/yourDomain.ts`") and loses the typed-client seam.
- **Option B — migrate pages back onto the clients** (restores convention; same URLs/types so low code risk). ~1–2 days across ~15 pages, but re-establishes a single seam where 3-layer type drift can be caught (see §5.5 openapi-typescript).

**Recommendation**: B for the modules where the client is *nearly* used (`lifting: 9/21`, `routes: 9/32`, `trainingPlans: 6/11`, `goals`, `conformity`, `notifications`, `weather`, `exercises`, `projections`), A for the 8 fully-dead modules. Then rebuild `CODEMAP.md` from the survivors.
- [ ] Decision recorded; then items in §0.2 CODEMAP become mechanical.

### 2.2 Sidebar & navigation fixes (S) — done 2026-09-06
- [x] `/routes/duplicates` page was **unreachable** from nav — added a "Duplicates" link in the routes page header actions (Upload GPX / Duplicates / Sync).
- [x] Active-state bug: `Sidebar.tsx` used exact `pathname === href` — switched to longest-prefix matching so `/routes/duplicates` and query-string deep-links highlight their parents, and child items (`/lifting/live`) win over parents on their own pages.
- [x] Dead **Delete Account** button (`settings/page.tsx:715`) had no handler — **removed** the Danger Zone card. Re-add with a real confirm modal + `POST /account/delete` as part of §3.9.

### 2.3 Minor correctness (XS-S) — done 2026-09-06
- [x] `dismiss_health_alert` accepted `alert_id: str` not UUID — malformed id caused a DB-level 500 instead of 422 (`api/metrics.py:334`). Now `uuid.UUID`.
- [x] `GET /charts/available` had no auth dependency (`api/charts.py:94-105`) — now requires the authenticated user.

---

## Part 3 — New features (P1–P2, from fresh exploration)

### 3.1 Body-weight logging UI — the biggest data gap (M)
`WeightLog` model + `GET /metrics/weight` + `weight_trend` chart exist, but weight is **Whoop-only**: no manual entry endpoint, no UI. DailyMetric/cycle-profile weight is separate. Users without a Whoop scale can't log weight at all, and W/kg + percentile charts degrade ("Log your body weight to enable it").
- [ ] Backend: `POST/PATCH/DELETE /metrics/weight` (`source="manual"` — the unique `(user_id, date, source)` constraint is already designed for it), serialization.
- [ ] Frontend: quick-add weigh-in (profile editor + dashboard today strip), editable history, integrate with W/kg charts and body-weight goal metric.
- [ ] Optional: a weight tab combining trend, 7-day EMA, deltas.

### 3.2 Dedicated Health page (M)
Health data is fragmented (dashboard Today/Weekly, calendar day panel, activity overlays) and **three ready endpoints are never rendered**: `SleepConsistencyResponse`, `SleepDebtResponse`, `OptimalBedtimeResponse` (`lib/api/types/health.ts`, backend `/metrics/sleep-*`).
- [ ] `/health` page: recovery + HRV + resting-HR + respiratory-rate trend charts, sleep (quality/consistency/debt/optimal bedtime), strain, health-alert history, AI health card.
- [ ] Backend: add the missing charts (§4.1) so this page is fully chart-driven.
- [ ] Nav: add "Health" item alongside the existing 11.

### 3.3 Race / event results & post-race retrospective (M)
`Event` is planning-only (`api/events.py`, no `services/events.py`, no result/outcome fields, no activity link). Training page lists upcoming only; `updateEvent` client exists with zero UI callers.
- [ ] Backend: `Event.result` block (finish time, placing, goal-met, notes), auto-link to the day's best-matching `Activity`, `services/events.py` extraction, past-events view.
- [ ] Frontend: "Add result" action, post-race retrospective comparing actual vs TSB race-day projection and planned conformity.
- [ ] Notification on event day.

### 3.4 Global ⌘K search (M)
Only per-page filters exist (activities, routes, exercises, routes-picker). No app-shell-level finder.
- [ ] Command-palette lookup across activities, routes, lifting sessions, exercises, PRs, goals; navigation to deep links (already supported: `?activity=`, `?route=`, `?session=`).

### 3.5 Notifications page (S)
Bell dropdown only, hard-capped at 50 (`NotificationBell.tsx:35-40`), no history/pagination.
- [ ] `/notifications` page with full history, type/read filters, "mark all read" — reuse the same query keys + type icons as the bell.

### 3.6 Unit & locale preferences (M)
Everything is hardcoded metric; locale literals are mixed (`'en-GB'` in activities/TimelineView/PatternsView/StatsView vs `'en-US'` in WeeklyView/PlanBuilder). No timezone or 12/24h preference.
- [ ] Settings section: unit system (kg/lb, km/mi), time format, date locale; centralize through `lib/utils.ts` (`formatDistance` is the single choke point) + a `useUnits`/`useLocale` hook.
- [ ] Normalize the mixed locale literals to the preference.

### 3.7 PWA offline + installability (M)
SW is network-only for `/api/v1/`, caches only the login shell, and there is **no `beforeinstallprompt` flow**. Live Lift is local-first but still gated on network for sync.
- [ ] Install prompt + `appinstalled` state in `PwaRegister.tsx`.
- [ ] Offline shell for the dashboard using last-known data (cache a snapshot of recent summaries), with a clear "offline — data may be stale" banner; keep API calls network-only (Pitfall 23).
- [ ] Live Lift: surfacing its own pending-sync queue offline is already designed; formalise an explicit offline mode.

### 3.8 Web Push notifications (M)
In-app notifications exist (`Notification` model: `type/link/read`, dedup key) but **no VAPID/webpush anywhere**. Four types fire today (pr, health_alert, goal_milestone, plan_reminder).
- [ ] VAPID keys + PushSubscription model + `web-push` delivery in `notify()`; SW `push`/`notificationclick` handlers.
- [ ] Per-type opt-in reuse of settings `NotificationSettings` toggles.

### 3.9 Full JSON data export + account deletion (M)
CSV/GPX/PDF exist; **Delete Account is a decorative button**. GDPR/privacy story is incomplete.
- [ ] Backend: `GET /export/json` (full user data incl. streams/weights/goals checks) + `POST /account/delete` (async task, cascade-aware), obfuscate-or-purge OAuth tokens.
- [ ] Frontend: add the confirm modal + wire the settings button (the old dead button + Danger Zone card were removed in §2.2; re-add them here).

### 3.10 Onboarding / first-run wizard (M)
**No onboarding exists** — only the login page and scattered empty-state CTAs. Data completeness (FTP, weight, home location, provider connects) gates deficiency, projections, weather, effort estimates.
- [ ] 3–4 step wizard (profile → providers → home/weight → first goal/plan), dismissible, re-openable from settings; gate only soft-prompt, never block.

### 3.11 Adaptive training suggestions (L)
Conformity (5C), readiness, deficiency, projections, health analysis are all computed — combine them into actionable weekly advice.
- [ ] Backend: `services/adaptive.py` producing a "shift" recommendation per week (volume/intensity/rest) from conformity deviations + TSB trajectory + deficiency priorities + recovery state.
- [ ] Frontend: suggestion card in `WeeklyView` with one-tap "apply" to plan days.

### 3.12 Alert tuning + new alert signals (M)
Signal thresholds/weights are hardcoded in `health_analysis.py`; no user control; `performance_decline` alert type is declared-but-unimplemented; sleep consistency and resting-HR trend are computed but never scored.
- [ ] Per-user override table (`user_preferences` JSONB): severity thresholds, weight overrides, snooze (per type + global quiet hours).
- [ ] Implement `performance_decline` (FTP/VO2max drop vs history) + sleep-consistency + resting-HR-elevation signals.
- [ ] **Fix: legacy threshold alerts (`hrv_drop`, `sleep_decline`, `respiratory_rate_elevated` in scheduler) insert `HealthAlert` rows without `notify()`** — inconsistent with the composite path (`health_analysis.py:748-762`). Add notify.

### 3.13 Ride segment analysis (L)
`ActivityStream` has 1s power/HR, routes have geometry/history/PBs — enough for Strava-style in-ride segments.
- [ ] Define segments from route history clustering (or full-ride splits), compute best efforts per segment, historical segment PRs, leaderboard-of-self.

### 3.14 Race-day prep PDF (S)
ReportLab generator exists; one new report wrapping conformity + TSB projection + weather forecast + fuel plan + taper checklist for an event date.
- [ ] `generate_event_report(event_id)` + export link from the training page event card.

### 3.15 Stale-data refresh UX (S)
`refetchOnWindowFocus: false` + 2–10 min `staleTime`s + no refetch buttons = silent staleness.
- [ ] Dashboard "last updated" timestamp + manual refresh; consider selective `refetchOnWindowFocus` for the dashboard only.
- [ ] Optional: light theme (dark-only today, hardcoded tokens — a full CSS-var migration, so deliberately **P3 / long-horizon**).

### 3.16 3D cycle activity visualisations (P2, L)
Add a 3D terrain-aware viewport for rides and routes — a "relive your ride" fly-through + 3D elevation/terrain route browsing. The data is already in-house: `ActivityStream` 1s power/HR/cadence/velocity/altitude streams, encoded route polylines, and `start_latlng`. The app currently renders everything in 2D on a Leaflet map + an `ElevationProfile` chart.

- [ ] **Ride replay (MVP)** — activity detail gets a 3D camera fly-through along the recording path, with a scrubber that scrubs through the activity and syncs an overlay of power/HR/cadence/altitude/velocity from the stream data (colour-map speed or HR on the path line). Reuses the existing per-activity stream endpoint; no new data required.
- [ ] **3D route view** — routes page detail: terrain extrusion + route polyline draped on it (replaces/augments the 2D `ElevationProfile`); zoom/rotate/pitch; quality / surface colouring overlaid.
- [ ] **Tech stack** — evaluate `maplibre-gl` (terrain 3D, open-source successor to the bundled Leaflet, lightest option with raster/elevation tiles) vs `deck.gl` (large stream-point rendering, best for overlays) vs `three.js` (full control, heaviest). Likely: **MapLibre GL terrain for routes + a lightweight three.js (or MapLibre camera path) fly-through for replay**.
- [ ] **Performance & capture plan** — lazy-load the 3D bundle only when a replay/3D view is opened (PWA + mobile: keep main bundle lean, guard <640px tap targets, respect reduced-motion); fall back to the existing 2D map/profile when WebGL is unavailable; decimate >1s streams to ~1s for camera path when needed.
- [ ] **3D comparison (stretch)** — extend the existing `CompareActivitiesModal`/`CompareRoutesModal` flow so the two picked rides can be replayed side-by-side in 3D with synced telemetry.

**Dependencies/links**: activity streams fetch endpoint (`api/activities.py`), route polylines (`RouteMap`/`ElevationProfile`), stream-overlay compare (§8A), ride segments (§3.13). Add a skill note if it becomes a repeatable pattern (like `add-chart`).

---

## Part 4 — Backend analytics & data-quality enhancements (P1–P2)

### 4.1 Missing charts (S — registry pattern makes these near-trivial)
Fields exist with **no chart**: resting HR, respiratory rate, standalone recovery score trend, calories (`DailyMetric`), lifting RPE trend, volume-per-muscle-group. `estimated_1rm_history`, `weekly_volume`, `sleep_quality_trend`, `whoop_strain_trend`, `recovery_vs_performance` are registered-but-unrendered (mark renderer TODO in CODEMAP).
- [ ] Add RHR + respiration + recovery-trend charts to the registry (`api/charts.py`) and render on the new Health page (§3.2).

### 4.2 Event results plumbing (see §3.3)
`no services/events.py` — business logic lives inline in the API layer; extract a service module before adding result fields.

### 4.3 FTP write-path validation + drift detection (S)
`POST /ftp-history` / `PATCH /profile` accept any `ftp_watts`; the 50–600W clamp exists only inside the estimator. No stale-FTP / detraining detection.
- [ ] Clamp + sanity-check write paths (400 on out-of-range, log).
- [ ] Weekly scan: suggest re-test when FTP is old or load/performance diverges from it (feed `auto_estimate_ftp_weekly`).

### 4.4 Notification type expansion (S–M)
Natural additions mirror existing features (no new infra): FTP auto-estimate / significant FTP change, connection `needs_reauth`, event countdown + taper-start, bad-weather ride-day alert, weekly summary / streak milestone, deload-started. Each needs the type added to all three lists (`services/notifications.py:13-18`, `models/notification.py:13`, `NotificationBell.tsx`).

---

## Part 5 — Performance & reliability (P1–P2)

| # | Item | Evidence | Fix | Effort |
|---|------|----------|-----|--------|
| 5.1 | **Injury-risk query bomb** | `analyze_injury_risk` issues ~18+ queries/user/run (3 per week × 6 weeks) in a daily per-user task | 2–3 aggregated SQL queries (volume sums, counts per week) | S |
| 5.2 | **In-memory rate limiter** | `slowapi` + `get_remote_address` (AGENTS-documented) — breaks across workers | Redis-backed limiter | S |
| 5.3 | **`/dashboard/today` uncached CTL/ATL/TSB** | recomputes 90-day TSS chain per request (`api/dashboard/today.py:181-185`) | 5-min Redis cache (mirror `CACHED_CHARTS`) | S |
| 5.4 | **Power-curve O(n²)** | inner sliding-window scan per duration bucket (`power_curve.py:266-278`) | reuse a single stream pass; extend the 1h in-memory cache | M |
| 5.5 | **LLM context builders** | 15+ sequential queries per analysis (`llm_analysis.py`) | batch aggregate queries | M |
| 5.6 | **`notify()` extra `select(User)`** | one query per notification (`services/notifications.py:63-64`) — ×users in plan reminders | include user or cache | XS |
| 5.7 | **Unbounded export reads** | full-table per user (`export.py`) | optional `start_date`/`end_date` window | XS |
| 5.8 | **Column-select in charts/alerts** | `weight_trend`, health-alerts load full ORM rows for 1–2 columns | `select(col)` | XS |
| 5.9 | **Type drift** | Pitfall 26 (3-layer manual updates) caused the dead-client + CODEMAP rot | `openapi-typescript` codegen from `/openapi.json` into `lib/api/types/generated.ts`; manual `types/` becomes deltas | L |

---

## Part 6 — Ops, infra & CI (P2–P3)

- [ ] **Prod compose GHCR names** hardcoded + case-sensitive (`docker-compose.prod.yml`) — parameterise or source from env.
- [ ] **Caddyfile ACME email** — real contact in `deploy.yml` heredoc (BUG-048).
- [ ] **Secret rotation** — BUG-045: rotate Komoot/Gemini/SECRET_KEY/NEXTAUTH secrets, shift server-side.
- [ ] **Prometheus alerting** — `/metrics` exists but no alert rules/dashboards; add alertmanager rules (5xx rate, sync failures, queue backlog) + a Grafana board.
- [ ] **Playwright in CI** — `test.yml` runs vitest but **no E2E**; add a job against a compose-up stack (note runner-queue constraints).
- [ ] `GET /health`/`/metrics` intentionally unauthenticated — document as design.

---

## Part 7 — Testing & verification (P2)

- [ ] **Component tests** — only 5 Vitest files (Chart, lifting-reference, fetch, ErrorBoundary). Extend: `useLiveSession` queue logic, sidebar nav, `formatDistance` unit/locale hook, goal/projection components.
- [ ] **E2E mutation flows** — current specs are render-heavy; add: live-lift create/log/finish, goal create → check-in, route tag + collection creation, GPX upload round-trip, deep-link navigation, notifications.
- [ ] Regression focus for §1.4 BUG-015: per-endpoint commit-graph tests before/after.

---

## Suggested execution order

1. **Phase A — hygiene (Part 0 + 2)**: land in-flight work → dead-client decision + cleanup → docs sweep → sidebar fixes. Re-sync `main`/`prod`.
2. **Phase B — quick backend wins (Part 4 + 5.1, 5.2, 5.3)**: new charts, weight CRUD, manual FTP clamp, legacy-alert notify fix, reauth/FTP event notifications.
3. **Phase C — user-facing (Part 3.1–3.5)**: weight UI, Health page, race results, ⌘K search, notifications page.
4. **Phase D — platform (Part 3.6–3.10)**: units/locale, PWA offline+install, web push, JSON export + delete, onboarding.
5. **Phase E — video + analytics (1.1, 1.3, 3.11–3.14)**: video system, post-sync analysis, adaptive suggestions, segments, alert tuning, race-prep PDF.
6. **Phase F — 3D visualisations (3.16)**: ride replay fly-through + 3D route terrain view (lazy-loaded, WebGL-guarded).
7. **Phase G — performance/infra (Part 5.4–5.9 + 6)**: caching, codegen, CI E2E, alerting.

Each phase is an independent feature branch + PR; phases are additive and independently ship-able to match the single-user release cadence (`main` → `prod`).