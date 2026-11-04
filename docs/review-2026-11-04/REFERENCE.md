# Reference — what "good" means for this audit

## References

### 1. The 2026-10-15 audit set (`docs/review-2026-10-15/`)

The strongest prior art in this repo. Every row has a `path:line` anchor, a severity, a confidence, and an explicit false-positive list. Its README also states the snapshot commit and the ways the plans had gone stale.

**Steal:** the evidence-anchor discipline, the "already fixed / do NOT chase" section, and the habit of re-checking plan claims against code.

**Do not steal:** its status is a snapshot, not a live queue. Six of its seven "confirmed defects" are already fixed, and its C-1/C-2 items are stale. A review that is not re-run becomes a trap for the next session.

### 2. `plans/quality-charter.md`

The project's own quality contract: fail-open runtime vs fail-closed gates, a SHOULD without a named gate is advisory, and "requirements → implementation → verification → review → integration".

**Steal:** the distinction between runtime degradation and gate failure, and the insistence that every claim names its enforcement file/test.

**Do not steal:** the assumption that the named gates exist. This audit found several that are narrower than their claim (doc-claim guard, dead-code report, E2E error test).

### 3. Playwright — best practices

<https://playwright.dev/docs/best-practices>

**Steal:** assert what the user sees; test the error, empty, and loading states separately; a test that only asserts the page title is not an error-path test.

**Anti-reference in this repo:** `frontend/e2e/lifting.spec.ts:177-187` — `handles API errors gracefully` asserts `main h1` contains "Lifting", which is true before and after the failure.

### 4. PostgreSQL — `pg_dump`

<https://www.postgresql.org/docs/current/app-pgdump.html>

**Steal:** a dump is an artifact only when it is on durable storage and has been restored at least once. The docs are explicit that `pg_dump` writes a file; they say nothing about the container layer being durable.

**Anti-reference in this repo:** `maintenance.py:174-179` writes `fittrack_backup_*.sql.gz` to `/backups`, while neither compose file mounts that path and `deploy.yml:196` removes the container.

### 5. Next.js security advisories

<https://nextjs.org/blog/security-update-2025-12-11> and the advisory set reported by `npm audit` (for example GHSA-7m27-7ghc-44w9, GHSA-f82v-jwr5-mffw, GHSA-2xp9-vwfh-vxw4).

**Steal:** a version with a critical advisory needs an explicit reachability decision. "No middleware, no `next/image`" rules some out; it does not rule out the App Router DoS and cache-poisoning classes.

**Anti-reference in this repo:** `frontend/package.json:40` pins `next: "14.2.15"` with no comment, no audit step, and no upgrade plan.

## Anti-references

### A. The test that certifies the wrong thing

`frontend/e2e/lifting.spec.ts:177-187` is named for graceful error handling and asserts only the heading. It is worse than no test, because it makes the failure look covered.

### B. The plan with zero checked boxes against shipped code

`plans/training-redesign-plan.md` has 0 `[x]` and 15 `[ ]` while the backend endpoints and most of the frontend shell exist. `plans/backlog-2026-09-20.md:132` still says "nothing built yet" while `AGENTS.md` says the overhaul shipped. A reader cannot tell shipped from open.

### C. The silent-success backup

`maintenance.py` returns `{"status": "success", "filepath": ...}` after writing into an unmounted container path. Celery records SUCCESS; no retry, no metric, no alert. The failure is discovered only during a restore.

### D. The global lint suppression that hides a live bug

`backend/pyproject.toml:63` ignores `F821` for SQLAlchemy forward refs. That also hides the four undefined auth-handler names in `scheduler.py`. The rule was right for models and too broad for tasks.

## Reference frames for the next look

When the P0/P1 set is fixed, capture these states rather than a happy-path screenshot:

1. Lifting `/lifting?session=<id>` with the Overview tab selected (tab trap).
2. Lifting `/lifting` with `/api/v1/lifting/sessions` returning 500 (error state, not skeleton).
3. Lifting edit panel: clear Focus, reload, verify it stayed cleared; switch sessions with Edit open.
4. Relive `/relive3d/<id>` on a non-Swiss ride (labels).
5. Training week with a multi-sport date and an event link -> unlink -> re-link (taper).
6. The weekly backup after a worker recreate (`/backups` must survive).
7. `/health` during a deliberately failed migration (must not be 200).

These are the "worst frames" for this project right now. Do not polish the dashboard while they are open.
