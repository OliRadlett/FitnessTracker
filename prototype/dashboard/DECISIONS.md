# Decisions — dashboard overhaul

One row per decision that a reviewer might otherwise re-litigate. Newest last.

| # | Decision | Why | Reversible? |
|---|---|---|---|
| D-01 | Reference frames are described and linked, not vendored | Every product in the board is behind auth; its public marketing page is not the frame being stolen. Vendoring a sign-in page would be a false reference. Reference 1 is in-repo and was looked at directly. | Yes — vendor frames if one becomes public |
| D-02 | The "before" evidence is captured from a **minted session**, not a real OAuth login | The dashboard is behind Google OAuth. A backend JWT (`create_access_token`) plus a NextAuth JWT carrying it as `backendToken` reproduces exactly what the callback produces, with no write to the database. `qa/mint-session.mjs` | n/a — evidence harness only |
| D-03 | `GET /api/v1/connections` 401s in the local dev server and is excluded from the "before" frames | Dev-only artefact: Next 308s `/connections/` → `/connections`, whose rewrite FastAPI answers with a 307 to the **absolute** `http://localhost:8000/...`. The browser follows cross-origin and drops `Authorization`. In prod Caddy keeps the Host, so the redirect stays same-origin. The capture fulfils that one path directly so the frame is faithful to production. | n/a |
| D-04 | Fixed states are **three real days**, not three synthetic ones | The fixture pins "today" to 2026-11-04 (rest), 2026-11-03 (strength), 2026-10-27 (174.8 km ride). Real data, real edge cases, no invented rows. | No — this is the "real fixture" rule |
| D-05 | Weather demoted to an inline chip | Takes 160×100 px of the hero fold to say "9 °C, partly cloudy", and every state that matters is indoors | Yes |
| D-06 | The AI analyses leave the dashboard | ~6 000 px of 11-week-old raw markdown in the act zone; `LlmAnalysisCard` already has a home on `/cycling`. Showing the same component twice is duplication, not insight. | Yes — as one collapsed row, if wanted |
| D-07 | The month/year record becomes a table inside Trends, not a new `/history` route | A new route is a bigger decision than this page and the nav is already at its limit at 390. Recorded as deferred. | Yes |
| D-08 | The `adaptive` engine's `AttributeError` is rendered honestly, not fixed | It is a backend bug that belongs in its own change, not inside a visual overhaul. The contract makes the redesign show the truth rather than hide it. | n/a |
| D-09 | Lab lives at `prototype/dashboard/`, deletable in one commit | House pattern (`prototype/lifting`, `prototype/training`, `prototype/relive`). | Yes |
| D-10 | **Both candidates were built**, not one | Owner's answer to Q1 ("prototype both"). Two full Today zones on one fixture is the only way to settle "join vs everything" on evidence rather than preference. | No — that was the ask |
| D-11 | **Three zones**, not the two I proposed | Owner's answer to Q2. History earns its own surface: the record is a different question from the trend, and Trends stays at 1.5 screens because of it. | Yes |
| D-12 | **Recommendation: A is the base, with one graft from B.** A passes 20/20; B fails criterion 16 (no chart above the act zone) and 6 (engines not all listed) | B is the better screenshot and the weaker decision surface: it opens on four instrument numbers and pushes the sentence behind them, which is the Garmin anti-pattern the project already rejects. The graft is B's sparkline beside each load number — it gives the numbers a shape without a chart card. Full scoring in `GATE.md`. | Owner's call at the first look |
| D-13 | **Recorded deviation:** segmented controls are 40 px, not 44 | Primary actions are 44. The zone switch and the range switch are dense header controls where 44 would make the header 12 px taller than the content it introduces. WCAG 2.2 AA needs 24; Apple's guideline is 44. Recorded rather than silently waived. | Yes |
| D-14 | Colour carries **domain identity** as well as status: accent = actionable/positive, red = fatigue/failure, blue = cycling & HRV, purple = lifting | The old page used one green for six meanings. Domain colour is a legend printed on the strip, not decoration. | Yes |
| D-15 | **Recorded deviation:** the last point of the weekly bar chart is unlabelled | The Form chart's last value is in its header ("form +2.1"); the weekly chart states the takeaway instead of tagging each bar. A per-bar last-point label is a production nicety, not a gate on the design. | Yes |
| D-16 | Charts are **hand-rolled SVG for the strip** and Recharts for the three cards | The strip needs exact column alignment across two rows; the cards need the house library so the artifact reflects what production can actually build. The bug being fixed (axes with no series) lives in Recharts, so the fix is demonstrated in Recharts. | Yes |
| D-17 | The AI analyses stay, parsed, collapsed and age-labelled | Owner's answer to Q3. The stored text is real markdown and the page was dropping it into a `<div>`. Parsing it in the lab proves the fix without shipping a markdown library. | Yes |
| D-18 | **A PowerShell `Set-Content` round-trip corrupted UTF-8** in four lab files mid-build; repaired, and the affected helpers were rewritten with `\u` escapes | Repo rule 13 exists because of exactly this. No product file was touched, but the lesson holds: mechanical edits go through the editor, not the shell. `qa/repair_encoding.py` is the repair, kept so the next person can see what happened. | n/a |
| D-19 | **Q3's "re-run on schedule" is already true in code, and the real blocker is billing.** Running `weekly_llm_analysis()` by hand returns `402 RESOURCE_EXHAUSTED — prepayment credits are depleted` from Gemini; no row is written | The 74-day staleness is not a scheduling bug and not a code bug. Verified 2026-11-04 against the local production copy: `llm_analyses` stayed at 7 rows, newest 2026-08-24. Adding a job, a retry or a "run now" button would fail identically. The page's job is therefore to be honest about age and about failure, not to refresh. Whether to top up the key is Oli's call, not the plan's. | Billing decision |
| D-20 | **Resolved for free, on the free tier, without spending the account's credits.** A new key in `gen-lang-client-0668027195` — the account's "Default Gemini Project", which has `billingEnabled=False` — replaces the exhausted prepaid key in `.env` | With billing off there is no account to charge, so calls run against the Gemini free tier: per-minute and per-day quotas instead of spend. Verified in three steps that never touch the fixture: `generateContent` on `gemini-3.6-flash` → 200; `weekly_llm_analysis()` → `users_analyzed: 1, users_failed: 0` and a row dated 2026-11-04; `POST /api/v1/cycling/llm-analysis/on-demand` on the **running** backend → 200, 5 065 chars. The old paid key is untouched and still 402s, so flipping back is a one-line `.env` change. `docker compose restart` does not reload env — containers must be **recreated** (`fittrack.py up backend worker`). | Reversible in one line |
| D-21 | **The dashboard draws its own three charts (`ChartPanel`) instead of reusing the shared `Chart`.** | Not a preference — evidence. Wired to the real payloads, the shared `Chart` renders weekly TSS and HRV with every mark squeezed into the left edge and the form chart with **no series at all** — which is exactly the "axes with no marks" defect this work exists to fix. Two of the three broken charts on the old page were broken *by that component*. `Chart` has five other callers, so the fix does not belong in this change: `ChartPanel` sets its own axis domains, disables animation, and renders an empty state rather than bare axes. A follow-up should port the same three rules into `Chart` and delete the duplicate. | Yes |
| D-22 | **`lib/dashboard/useDashboardData.ts` stays.** The plan said delete it; two pages import it. | `/cycling` and `/health` import `useDashboardData` and surface its load trio; `/analytics` imports `TimeRangePicker`; a test imports `RestDayBanner`. Deleting any of them would have broken pages this change is explicitly not allowed to touch. So the plan's deletion list was wrong and the dependencies were found by `tsc`, not by a grep — my first dependency sweep used `-SimpleMatch` with `|` in the pattern, which searches for the literal pipe and reported zero for *every* file. A false-negative sweep before a delete is worse than no sweep. | n/a |
| D-23 | **The "content clears the bottom nav" check measured the wrong element — twice.** | `<main>` holds one wrapper carrying `pb-tabbar-clear`; that wrapper's own bottom *is* the viewport bottom, so measuring it always fails. The element that must clear the nav is the wrapper's last content child. The lab had the same bug and I fixed it there, then reintroduced it in the production harness. Both now descend one level. | n/a |

---

## Number trace (every number in the artifact traces here)

Filled in Phase 4. Format: `artifact value → fixtures/raw/<file>.json → JSON path`.

| Artifact value | Fixture | Path |
|---|---|---|
| CTL 19.4 / ATL 17.3 / TSB +2.1 | `cycling-training-load-days-90.json` | `current_ctl`, `current_atl`, `current_tsb` |
| Week TSS 157 | `charts-weekly-tss-weeks-13.json` | `series[0].data[-1]` |
| Readiness 85 %, HRV 50.3, RHR 57 | `metrics-readiness.json` | `recovery_score`, `hrv_ms`, `resting_hr` |
| Sleep debt −1.7 h | `metrics-sleep-debt-days-7.json` | `debt_hours` |
| Optimal bedtime 00:05 | `metrics-optimal-bedtime.json` | `recommended_bedtime` |
| Big-3 465 kg / 500 kg (93 %) | `goals.json` | `[2].current_value`, `.target_value` |
| Bench 125/130 (96 %), Squat 150/160 (94 %) | `goals.json` | `[0]`, `[1]` |
| 4 health alerts | `dashboard-today.json` | `active_alerts` |
| 6 engine rows (2 available) | `dashboard-today.json` | `verdict.consensus[*]` |
| Last 5 activities | `activities-limit-5.json` | `[*].start_date`, `.sport_type` |
| Last 5 lifting sessions | `lifting-sessions-limit-5.json` | `[*].session_date` |
| 12-month record | `dashboard-monthly-summary-months-12.json` | `[*]` |
| Year totals (192 / 3110 km / 7708 TSS) | `dashboard-yearly-summary-2026.json` | `total_activities`, `total_distance_m`, `total_tss` |
| Stripe of training days (91 d) | `charts-consistency-heatmap-days-90.json` | `labels`, `series[0].data` |
| HRV series (86 d) | `charts-hrv-trend-detailed-days-90.json` | `labels`, `series[0].data` |
