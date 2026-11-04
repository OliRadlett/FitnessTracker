# FitTrack project audit — 2026-11-04

**Target:** `origin/main` @ `d2a7fd0` (clean export; the working checkout is 42 commits behind and has another session's dirty tree)
**Owner:** feature lead, this session
**Status:** artifact complete; release gate **FAIL** (9 open P0/P1)
**Post-audit fixes:** branch `fix/audit-p0-2026-11-04` — all 9 P0/P1 fixed in code; the deploy path still needs a release run to verify; see [FIXES.md](FIXES.md).
**Recommendation:** **iterate** — fix the P0/P1 set before building anything new

---

## 1. Diagnosis (one page)

### What the user is trying to do

Trust one training record across lifting, cycling, sleep, and recovery, then decide what to do today. The product's thesis is that the record is joined up: a ride changes TSB, a lifting session changes load, a sleep night changes readiness, and `/today` composes the answer.

### What exists today, with evidence

The project is not thin. It has 45 tables, six provider integrations, a dashboard, training-plan editor, lifting overhaul, Google 3D ride viewer, goals, routes, health, and a weekly analytics stack. The baseline is green:

| Check | Result |
|---|---|
| Backend unit suite | **1756 passed**, 794 deselected (176.6 s) |
| Frontend unit suite | **741 passed** across 76 files (187.6 s) |
| TypeScript | `npx tsc --noEmit` clean |
| Ruff | `python -m ruff check backend/` clean |
| Doc-claim guard | 2 passed |

That is the central finding: **quality is not capped by a red build.** It is capped by what the green build is allowed to certify.

### Why the current quality is capped

**Process causes**

1. **Tests assert page chrome, not behaviour.** The lifting E2E test named `handles API errors gracefully` asserts only that the `<h1>` says "Lifting"; the sessions query has no error state at all, so a 500 renders skeletons forever and the test stays green (`frontend/e2e/lifting.spec.ts:177-187`, `frontend/src/app/(app)/lifting/page.tsx:217-222`, `:623`).
2. **The truth guards are narrower than the claims.** `test_doc_claims.py` checks `docs/RUNNING.md` only; `AGENTS.md:223` says "New migrations continue from 097" while the head is **103**, and `AGENTS.md` simultaneously says UndoLog has no HTTP surface and that C6 shipped one. Pitfall 38 claims a pre-commit hook runs tests; the hook is ruff-only.
3. **Plans are not a status surface.** `plans/training-redesign-plan.md` has 0 checked / 15 unchecked boxes against shipped endpoints and components; `plans/backlog-2026-09-20.md:132` still says the training overhaul is "nothing built yet" while `AGENTS.md` says it is shipped.
4. **Dead code is report-only and non-gating.** `test_repo_invariants.py` deliberately forbids the dead-code report from failing CI. That is why the 2026-10-15 audit's stale queue survived two weeks: nothing forces a re-check.
5. **There is no production release/DR gate.** The deploy starts containers before migrating, health-checks only `SELECT 1`, and writes backups into an unmounted container path. All three are silent-success shapes.

**Technical causes**

1. **A global lint suppression hides a live `NameError`.** `F821` is ignored repo-wide for SQLAlchemy forward refs, so the auth handlers in the 30-minute sync call `mark_connection_reauth` and `handle_sync_http_error` without importing them. A revoked token crashes the task and skips every later user.
2. **Derived fields are written only on some paths.** `estimated_tss` is computed on session PATCH and the Sunday backfill, not on session create or set writes. The local fixture has **4 sessions with sets and 0 with TSS**. Jev labels have the same shape: the content hash exists, but set writes never schedule reclassification.
3. **Production compose drift.** The frontend publishes `0.0.0.0:3000`, inherits `NODE_ENV=development`, and the deploy regenerates a Caddyfile without the committed security headers.
4. **The newest UI was built around fixture assumptions.** Relive presets are hard-coded `Lausanne` / `Montreux` on every ride, with a backend branch for a route containing "arthur".
5. **The tabbed lifting IA has a state bug.** The deep-link effect depends on `getParam`, which changes whenever `setParam` writes the URL; with `?session=` still present, every tab change is overwritten back to Sessions.

### What "good" looks like

| Reference | What to steal |
|---|---|
| `docs/review-2026-10-15/` | Every finding carries a `path:line` anchor and a confidence, and false positives are listed explicitly. This audit keeps the shape. |
| `plans/quality-charter.md` | Fail-open runtime vs fail-closed gates; "a SHOULD without a named gate is advisory". |
| Playwright best practices | Assert what the user observes; error/empty/loading are separate states, not one skeleton. |
| PostgreSQL `pg_dump` docs | A dump is only a backup if it is on durable storage and restorable. |
| Next.js security advisories | A framework line with a critical advisory needs a stated reachability decision, not silence. |

**Anti-references**

- A test named `handles API errors gracefully` that asserts the page heading.
- A plan with 0 checked boxes while the code is shipped.
- A task that logs "backup completed" into a container layer that the next deploy deletes.

### The artifact

One artifact: **this dossier plus a machine-checkable findings register**. `AUDIT.md` is the readable artifact; `findings.json` and `qa/verify_audit.py` make every claim reproducible and re-checkable. The artifact gate passes today; the release gate fails because the findings are real.

### Out of scope

No production code changes, no dependency upgrade, no feature work, no full visual redesign, no production database access, no complete 45-table audit, no re-fetch of the primary sports-science literature. Those are separate decisions after the P0/P1 set.

### First look

2026-11-04, same session. It shows the register, the verifier table, and the top-five reproductions. **Stop condition:** if fewer than 8 findings reproduce, or any P0/P1 evidence is stale, re-scope instead of writing more.

---

## 2. Quality contract

```
SURFACE:         Repository-wide audit — backend, frontend, ops/release, docs.
CURRENT STATE:   origin/main@d2a7fd0 + local DB aggregate; baseline green, 8 P0/P1 open.
ARTIFACT:        A re-verified audit dossier (AUDIT.md) + findings.json + verifier.
REFERENCE:       2026-10-15 audit method, quality-charter gate language,
                 Playwright error-state practice, PostgreSQL backup durability,
                 Next.js security advisories.
GATE:            `python docs/review-2026-11-04/qa/verify_audit.py --repo <tree>`
                 exits 0: all 24 evidence anchors hold, baseline green,
                 top 5 have a command, false positives are listed.
                 Release gate (--strict) exits 0 only when no P0/P1 is open.
NON-GOALS:       No code fixes, no dependency upgrade, no new features, no
                 production changes, no full visual/UX audit, no prod DB access.
GOLDEN FIXTURE:  origin/main@d2a7fd0 + local DB aggregate: 1 user, 582
                 activities, 4 lifting sessions, 86 routes; 4/4 sessions with
                 sets and 0/4 with estimated_tss. Aggregate only, no PII.
FIRST LOOK:      2026-11-04 — register + verifier + five reproductions.
KILL CRITERION:  <8 findings reproduce, or any P0/P1 evidence cannot be
                 re-checked, or the baseline is not green.
OWNER:           Feature lead (this session).
```

**Gate definitions**

- **Artifact gate** (`--artifact`, default): every finding's evidence still exists. This is a snapshot integrity check.
- **Release gate** (`--strict`): no P0/P1 finding remains open. It is expected to **fail** today. That failure is the recommendation to iterate.

---

## 3. Findings register

Full structured evidence: [`findings.json`](findings.json). Machine-readable status: [`qa/first-look.txt`](qa/first-look.txt).

### P0 — stop and fix

| ID | Finding | Evidence | Impact |
|---|---|---|---|
| **AUD-00** | Both auth handlers call names that are never imported; a revoked token raises `NameError` and aborts the 30-minute sync | `scheduler.py:102` imports only `CONNECTION_STATUS_NEEDS_REAUTH`; `:212`, `:223`, `:270`, `:279` call `mark_connection_reauth` / `handle_sync_http_error`; `ruff --select F821` reports 4; `pyproject.toml:63` ignores F821 repo-wide | Remaining Strava users and the whole Wahoo loop are skipped every run; the connection is never marked `needs_reauth`; sync stays dead |
| **AUD-01** | Weekly backup is written inside the worker container with no volume; every deploy runs `compose down` | `maintenance.py:174-179`; `config.py:159` `/backups`; neither compose file mounts it; `deploy.yml:196` down; failures return `{"status":"failed"}` instead of raising | No durable backup; "successful" backups are destroyed by the next release; restore is impossible |

### P1 — fix before calling the release healthy

| ID | Finding | Evidence | Impact |
|---|---|---|---|
| **AUD-02** | Lifting tabs bounce back to Sessions after a session is selected | `lifting/page.tsx:157-175` deps `[getParam]`; `:168` forces Sessions; `useDeepLink.ts:20` keyed on `params` | The new tabbed IA is unreachable after the first session click; `?pr=` traps PRs the same way |
| **AUD-03** | `estimated_tss` is not computed on create or set writes | `lifting.py:306-378`, `:717-774`, `:830-843`, `:885-891`; only PATCH `:528-529` and the Sunday task compute it; fixture 4 sessions with sets / 0 with TSS | Lifting load is invisible to combined load and deload detection for up to 7 days; the rail shows "— TSS" |
| **AUD-04** | Plan-day create accepts foreign route/session/template IDs and the week reader returns their metadata | `schemas/training_plan.py:92-94`; `training_plan.py:2877`; readers `:2354-2371`, `:2487-2501` | Cross-tenant metadata disclosure (UUID-gated), and a bogus ID returns 500 instead of 4xx |
| **AUD-05** | Production publishes frontend `0.0.0.0:3000` and keeps `NODE_ENV=development` | `docker-compose.yml:90-99`; `docker-compose.prod.yml:56-59` adds no ports/NODE_ENV | Plain-HTTP app and `/api/v1` proxy reachable off-host, bypassing Caddy TLS and headers |
| **AUD-06** | Migrations run after containers start; startup swallows failure; `/health` ignores schema revision | `main.py:31-50`, `:134-166`; `deploy.yml:199-202` | A half-applied release can report healthy; no rollback path |
| **AUD-07** | The async weather task calls the blocking Modal dispatcher; the async wrapper is dead | `scheduler.py:1269`, `:1432`; `weather_analysis.py:666`; `aanalyze_` has no production caller | Weekly task blocks the event loop (~30 s/user) and trips Modal's warning; its regression test guards the dead wrapper |
| **AUD-23** | The webhook drain marks an auth-failed event `failed` and aborts the whole queue | `webhook_queue.py:64-78`; `failed` is terminal; no replay endpoint | Revoked-token events are permanently lost; other users' events wait behind the break |

### P2 — the quality ceiling (primary register)

| ID | Finding | Impact |
|---|---|---|
| **AUD-08** | A failed sessions query renders infinite skeletons / empty page; the E2E error test only checks the `<h1>` | The page looks stuck; operators cannot tell failure from loading |
| **AUD-09** | The session rail stops at the newest 50; `s_split` / `s_class` / `s_ex` / `s_page` are dead | Older sessions are unreachable and search is limited to the last 50 |
| **AUD-10** | The edit-session panel keeps the previous session's values and cannot clear focus/notes | Clearing a field silently no-ops; switching sessions with Edit open can PATCH B with A's date |
| **AUD-11** | Relive presets are `Lausanne` / `Montreux` on every ride; backend special-cases "arthur" | Wrong, fixture-specific labels on real rides |
| **AUD-12** | A completed today/future plan day reports `pending` | Today's finished session reads as Planned; the overview undercounts done days |
| **AUD-13** | Event unlink keeps the end-date clamp and taper; re-link compounds it; multi-sport taper is per row | Planned TSS silently shrinks; 0.4 becomes 0.16 on the last day after two links |
| **AUD-14** | Jev labels are not recomputed after set writes | Conformity, `/today`, mix charts, and goals read stale labels for up to a week |
| **AUD-15** | Repo truth guards are narrower than the claims (AGENTS 097 vs 103, UndoLog contradiction, pre-commit, rollback, BUGS.md) | Future sessions act on stale claims; the guard passes while the doc is false |

### Secondary register (real, but below the P0/P1 release gate)

| ID | Finding | Why it is secondary |
|---|---|---|
| AUD-16 | Next.js 14.2.15 has 1 critical / 2 high / 1 moderate advisories | No `middleware.ts` and no `next/image`; part is unreachable, but the app-router DoS class remains |
| AUD-17 | Deploy regenerates Caddyfile without the committed security headers | Real production gap; fixed at deploy time, not in app code |
| AUD-18 | Secret validation is gated on `DEBUG`; `.env.example` ships `DEBUG=true` | A deployment footgun, not a live exposure if prod `.env` is correct |
| AUD-19 | Account deletion leaves lift videos in R2 | Privacy contract gap; needs an R2 lifecycle decision |
| AUD-20 | Web Push `endpoint` is unvalidated (blind SSRF), latent until VAPID is set | Real class, but gated on `push_enabled` |
| AUD-21 | Full-array plan save deletes omitted `(date, sport)` pairs; the test asserts the opposite of its name | Destructive contract, currently unreachable from the new editor |
| AUD-22 | Weekly volume chart is hard-capped at 30 t | Heavy weeks clip; a one-component visual defect |

---

## 4. Top five reproductions

1. **AUD-00 (critical, one command).** In a clean checkout:
   ```powershell
   python -m ruff check backend/app/tasks/scheduler.py --select F821
   ```
   It reports four undefined auth-handler names (and two postponed annotations). The four are `scheduler.py:212`, `:223`, `:270`, `:279`.

2. **AUD-03 (data correctness, real fixture).**
   ```powershell
   docker exec fitness-tracker-db-1 psql -U fittrack -d fittrack -t -A -c "select count(*) from lifting_sessions; select count(*) from lifting_sessions where estimated_tss is not null; select count(distinct session_id) from lifting_sets;"
   ```
   Returns `4`, `0`, `4`: all sessions have sets, none has TSS.

3. **AUD-01 (durability, config).**
   ```powershell
   Select-String -Path docker-compose.yml,docker-compose.prod.yml -Pattern '/backups'
   ```
   Returns nothing. `maintenance.py` writes to `/backups`; `deploy.yml:196` removes the container.

4. **AUD-02 (UX, manual).** Open `/lifting?tab=sessions`, select a session, click Overview. The URL changes to `tab=overview`, then the effect at `page.tsx:157-175` re-applies `?session=` and forces Sessions back.

5. **AUD-06 (release safety, config).** `deploy.yml` runs `up -d` before `alembic upgrade head`; `main.py` logs a failed migration and continues; `/health` only checks `SELECT 1`.

---

## 5. First-look evidence

Command:

```powershell
python docs/review-2026-11-04/qa/verify_audit.py --repo C:\Projects\fitness-tracker-audit-main
```

Result (also saved at [`qa/first-look.txt`](qa/first-look.txt)):

```
target: origin/main @ d2a7fd0
fixture: {'users': 1, 'activities': 582, 'lifting_sessions': 4, 'routes': 86, 'training_plan_days': 0}
         ({'lifting_sessions_with_sets': 4, 'lifting_sessions_with_duration': 4, 'lifting_sessions_with_tss': 0})

AUD-00  P0*  OPEN       backend / sync reliability
AUD-01  P0*  OPEN       operations / disaster recovery
AUD-02  P1*  OPEN       frontend / lifting
AUD-03  P1*  OPEN       backend / lifting data correctness
AUD-04  P1*  OPEN       backend / authorization
AUD-05  P1*  OPEN       production config / security
AUD-06  P1*  OPEN       release safety
AUD-07  P1*  OPEN       backend / reliability
AUD-23  P1*  OPEN       backend / sync reliability
... (24 findings; all OPEN at audit time)

artifact gate: PASS
release gate: FAIL (9 open P0/P1: AUD-00, AUD-01, AUD-02, AUD-03, AUD-04, AUD-05, AUD-06, AUD-07, AUD-23)
```

The artifact gate passing means the report is reproducible. The release gate failing is the decision: **iterate**.

---

## 6. Recommendation and production plan

**Recommendation: iterate, do not productionize new work.**

The ceiling is fixable, and the product is valuable. This is not a kill. But the next release should be a **stabilisation release**, not a feature release.

### Phase 1 — stop the bleeding (one focused branch, tests first)

1. **AUD-00**: import the two handlers, narrow the F821 ignore to `app/models/*`, add a test where `sync_activities` raises `PermanentAuthError` and assert both users are attempted and `mark_connection_reauth` is awaited.
2. **AUD-03**: call `refresh_session_tss` at the end of create/add/update/delete set; add a DB invariant test (session with working sets + duration => non-null TSS).
3. **AUD-02**: make the deep-link read mount-only (read `window.location.search` directly or ref-guard it); clear `session`/`pr` on tab change; add a Playwright case that selects a session and clicks Overview.
4. **AUD-04**: one ownership helper for the three FK refs; scope the week/LLM readers by user; test a foreign id returns 4xx and is absent from the payload.

### Phase 2 — make production honest (ops work)

5. **AUD-01**: mount `/backups` (host bind or named volume) in the worker, fail loudly when the path is not a mount, add a freshness metric/alert, and run a restore drill.
6. **AUD-05**: loopback-bind or unpublish 3000 in prod; set `NODE_ENV=production`.
7. **AUD-06**: run migrations in a one-shot container before `up -d`; fail closed on startup; include the DB revision in `/health`; document `IMAGE_TAG` rollback.
8. **AUD-07**: call the async wrapper; retarget the test at the scheduler path.
9. **AUD-23**: mark the connection needs_reauth, leave the event pending, continue with other users, and add a replay path.

### Phase 3 — the quality ceiling

10. AUD-08, 09, 10, 11, 12, 13, 14, 15, then the secondary register.
11. Add the verifier to CI as advisory for one week, then blocking on P0/P1. Add a `verify_audit.py --strict` release job.
12. Re-run the baseline and update `findings.json` statuses. Do not delete a finding until its check fails (that is the FIXED signal).

### Enhancement opportunities (not bugs, not in the release gate)

- **Pagination with an honest total.** Use the existing `X-Total-Count` and `s_page` contracts, or remove them; either way stop claiming "All N" over a 50-row page (AUD-09).
- **A derived-field invariant.** One test that walks any lifting session with working sets and a duration and asserts `estimated_tss` is not null; the same shape for Jev labels. This catches the class, not just the two instances (AUD-03/AUD-14).
- **A real production release gate.** Backup mount check, migration-head health, and a header check on the deployed Caddy response. These are cheap and catch the entire silent-success family (AUD-01/05/06/17).
- **A state harness per new surface.** Lifting and Relive each need one deterministic capture for loading / error / empty / populated, plus the tab deep-link case. Code tests cannot see the tab trap (AUD-02/AUD-08).
- **A truth test for AGENTS and plans.** Extend `test_doc_claims.py` to the migration sentence and the shipped/not-shipped status of the active plans; stale plans are the most expensive documentation failure in this repo (AUD-15).

### Rejected / not done

- **No code fixes in this session.** The working tree belongs to another session and is 42 commits behind `main`; a fix here would be a prototype, not a release.
- **No production database access.** The fixture is the local production-shaped DB; the limitation is stated in `findings.json`. A prod read-only check is a follow-up, not a substitute for the code evidence.
- **No full visual pass.** The report's visual claims are code+config findings (labels, chart cap, error state), not screenshot judgments. The next look should capture the lifting error state, the tab trap, and a heavy-volume week.
- **No dependency upgrade.** Next.js 14 -> 16 is a breaking migration and needs its own plan.
- **No re-report of fixed 2026-10-15 items.** BUG-R01/R30/R31/R32, orphan quarantine, UndoLog's HTTP surface, RUNNING.md's head/phantom/pitfall claims, and AGENTS' "Nothing built yet" were re-verified as fixed and excluded.
- **False positives rejected:** ghost `claim_map=0` does not 500 (budget fields have defaults); session-date string comparisons are safe (`YYYY-MM-DD`); all new queries use `enabled: !!token`; no unsafe HTML in the new surface; `refetchOnWindowFocus` is globally false, so the map is not re-initialised on tab focus.
- **Dead code deletion rejected.** The project's standing decision is report-only; this audit flags the surface (`generated.ts`, `mode-shell/`, UndoLog without a frontend caller) but does not delete it.

---

## 7. What was read, and what was skipped

**Read:** `AGENTS.md`, `docs/RUNNING.md`, `docs/BUGS.md`, `plans/quality-charter.md`, the 2026-10-15 audit set, `plans/backlog-2026-09-20.md`, `plans/training-redesign-plan.md`, the relive/lifting plans, the new lifting/relive code, the scheduler split and its tests, compose/deploy/Caddy config, the Jev label and training-plan services, and the 2026-10-15 science review for prior status.

**Skipped:** a full read of all 45 tables and every service; a primary-literature re-fetch; a live production session; the full visual contact sheet; dependency CVE reachability beyond `npm audit`; and every finding already fixed in the 2026-10-15 set.

**Reproduce the baseline:**

```powershell
powershell -File docs/review-2026-11-04/qa/run_baseline.ps1 -Repo C:\Projects\fitness-tracker-audit-main
```

The verifier against the current checkout is expected to report FIXED/DRIFT for findings that land on `main` after `d2a7fd0`; re-run it after merging.
