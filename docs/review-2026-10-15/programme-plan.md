# Repo health programme plan

FitTrack's cleanup and health programme, from the audit in this folder. Wave 1 is three
independent PRs, PR-01 doc-truth guards, PR-02 the numeric-bound guard, PR-03 dead-code
reporting. Later waves cover the silent-failure and timezone guards, the confirmed bugs, the
science fixes, the Celery beat registry, observability, and the god-file split. The rule the
programme enforces is that every check the repo relies on must fail on the pre-fix code before
it is trusted. Dead code is reported, never deleted, per the operator's decision. PRs target
`main`, never `prod`, and this folder is the plan of record.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. Check a box only when its evidence exists.
That evidence is a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

The programme would run `skills/poteto-mode/playbooks/autopilot-stack.md` from the installed plugin,
because the work is sequenced and merge authority is withheld. That playbook and its siblings need
`bun`, which this machine does not have, so they are unavailable. Follow this document instead. It
keeps the same shape, one owner per PR, scripted live lanes run from the main session, and a root
verdict before the operator merges. Subagent nesting is one level on this runtime, so the root
dispatches every lane and a lane cannot fan out. The operator merges every PR.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on the operator's explicit go.
- [ ] On the operator's go, write this exact text into the standing orders and restate it in your todolist. "Plan at `docs/review-2026-10-15/programme-plan.md`, wave 1 PR ids PR-01, PR-02, PR-03 in that order, verification rule is unit plus live plus perf per PR, the operator merges, done when every box in wave 1 is checked."
- [ ] Read these from the installed plugin at program start. Re-read them at every tick.
  - [ ] `skills/poteto-mode/playbooks/autopilot-stack.md`
  - [ ] `skills/swarm/SKILL.md`
  - [ ] `skills/poteto-mode/playbooks/opening-a-pr.md`
  - [ ] `skills/show-me-your-work/SKILL.md`
- [ ] Arm the hourly audit tick as a real `/loop` in dynamic mode, which schedules its own wake-up rather than blocking on a sleep. Never leave the cadence to memory.
- [ ] Use this tick prompt, verbatim. "Re-read the execution playbook from the installed plugin and the standing objective. Audit the operation against both and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a stuck lane and dispatch its replacement now. Then post a short status message to the operator in chat only when the audit found a tracked change that no earlier status message reported. Name every such change and nothing else. If the audit found none, end the turn with no reply text."
- [ ] On the operator's hold or stand-down, send every owner a zero-writes order at once.

### Spawn owners

- [ ] Spawn one owner per PR with the full lifecycle this plan names.
- [ ] Follow this dependency graph. Start dependent work only after its parent merges, or base it on the parent branch when the execution playbook stacks.
  - [ ] PR-01, PR-02 and PR-03 are independent and first. All three branch from `main`.
  - [ ] Wave 2 and wave 3 start only after wave 1 merges. They are listed in Appendix D.
- [ ] Hold the file boundaries. PR-01 touches only `docs/RUNNING.md`, `AGENTS.md` and `backend/tests/`. PR-02 touches only `backend/app/schemas/route.py`, `backend/app/services/effort_estimator.py` and `backend/tests/`. PR-03 touches only CI config, `backend/pyproject.toml`, `frontend/package.json` and `.github/workflows/`.
- [ ] Hold the review gate. No wave 1 PR changes a user-visible interaction, so all three are not review-gated and merge on the operator's click after the root verdict.

### PR mechanics, for every PR

- [ ] Resolve the forge once. Default to `gh`. Record any fallback. Never require `gt`.
- [ ] Open the PR ready, never draft, per **Opening a PR**. `gh pr create --base <base-branch>` according to the resolved forge.
- [ ] Run the repo's lint and typecheck once before the PR-facing push. Push with hooks on.
- [ ] Run `/deslop` before each commit and `/no-comments` before review.
- [ ] Triage every review-bot and security-reviewer comment per `references/bugbot-triage.md`.

### Verdict and merge, for every PR

- [ ] A full swarm runs once, at the code-ready head. One gates lane, the ten live lanes from the PR's **Verify, live** block, the perf lane from its **Verify, perf** block, and two audit lanes that read the diff and distrust the PR body. The root audits the receipts before the verdict.
- [ ] Clean only when every lane is `PASS`. Findings go back to the owner. A new head gets a fresh verdict.
- [ ] The owner reports STACK-READY. Only the root retargets. The operator lands each PR bottom-up.

### Boot recipe, for every live lane

Each live lane runs in its own worktree at the PR head. Drive through the exact commands recorded here.

- [ ] `git fetch origin <head-branch> && git checkout <head SHA>`.
- [ ] Rebuild so the image matches the head. Run `python fittrack.py build`, then `python fittrack.py up`, then confirm with `python fittrack.py exec backend python -c "import app.main; print('ok')"`. A lane that skips the rebuild tests stale code.
- [ ] For host tests, copy `.env` into the worktree and export the env vars from `.github/workflows/test.yml`, which are `SECRET_KEY`, `DEBUG=true`, `DATABASE_URL`, `TEST_DATABASE_URL` and `REDIS_URL`, before running pytest. Without them collection fails and reads as a regression.
- [ ] Start the backend, wait for `/health` to answer, then run `python fittrack.py exec backend alembic current`.
- [ ] Deliver input only through the recorded commands. Read-only diagnostics are `python fittrack.py logs backend --tail 30` and `python fittrack.py exec backend alembic heads`.
- [ ] Save every captured output to `/tmp/swarm-<pr-id>/worker-<n>/<slug>.log` and return the paths with the report.

## Prove the docs tell the truth (PR-01)

**Depends on.** None.

**Files.**

- [ ] Edit `docs/RUNNING.md`.
- [ ] Edit `AGENTS.md`.
- [ ] Create `backend/tests/test_doc_claims.py`.

**Build.**

- [ ] Add `test_doc_claims.py` asserting the head in `docs/RUNNING.md` equals the head computed from the revision files, and that every migration file the doc names exists.
- [ ] Rewrite the `docs/RUNNING.md` test section to lead with the host command and cite pitfall `23`.
- [ ] Replace the stale `AGENTS.md` training sentence with the shipped state.

**You see.**

- [ ] `python -m pytest backend/tests/test_doc_claims.py -q` reports `2 passed` at head and fails on trunk.
- [ ] The string `079(head)` no longer appears in `docs/RUNNING.md`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `backend/tests/test_doc_claims.py` gains a case that reads the real files and asserts the head string. Run `python -m pytest backend/tests/test_doc_claims.py -q`.
- [ ] Negative check. Revert the `docs/RUNNING.md` line in a scratch copy and confirm the same test fails with the head mismatch.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `python -m pytest backend/tests/test_doc_claims.py -q` at trunk and head. Trunk has no such test, so gate the behavior the diff adds. Save `/tmp/swarm-pr-01/lane-01-regression.log`. Pass when trunk reports collection error and head reports `2 passed`.
- [ ] Lane 2. Run `python fittrack.py exec backend alembic heads` and diff against the documented head. Save `/tmp/swarm-pr-01/lane-02-head.log`. Pass when the two strings match.
- [ ] Lane 3. Grep `docs/RUNNING.md` for the phantom file name. Save `/tmp/swarm-pr-01/lane-03-phantom.log`. Pass when the grep returns nothing.
- [ ] Lane 4. Grep `docs/RUNNING.md` for the wrong pitfall number `#19`. Save `/tmp/swarm-pr-01/lane-04-pitfall.log`. Pass when the grep returns nothing.
- [ ] Lane 5. Run `ruff check backend/`. Save `/tmp/swarm-pr-01/lane-05-ruff.log`. Pass when it exits zero.
- [ ] Lane 6. Run `npx tsc --noEmit` in `frontend/`. Save `/tmp/swarm-pr-01/lane-06-tsc.log`. Pass when it exits zero.
- [ ] Lane 7. Run the full host unit suite `python -m pytest backend/tests -q -m "not integration"`. Save `/tmp/swarm-pr-01/lane-07-suite.log`. Pass when the failure count is unchanged from trunk.
- [ ] Lane 8. Run every repo grep the new test performs, by hand, and compare. Save `/tmp/swarm-pr-01/lane-08-manual.log`. Pass when the manual result matches the test.
- [ ] Lane 9. Check the `AGENTS.md` training sentence against the editor-primitive routes `POST /days`, `DELETE /days/{id}` and `POST /days/{id}/swap` in `backend/app/api/training_plans.py`. Save `/tmp/swarm-pr-01/lane-09-agents.log`. Pass when the sentence names the shipped endpoints.
- [ ] Lane 10. Confirm every relative link in the four audit docs resolves. Save `/tmp/swarm-pr-01/lane-10-links.log`. Pass when no link 404s.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Host unit-suite wall time, measured at trunk and at head.
- [ ] Probe. `python -m pytest backend/tests -q -m "not integration"` run at trunk then head, interleaved three times, and take each side's median. Both sides must produce the number.
- [ ] Baseline. Record the trunk median first.
- [ ] Rule. This PR changes no runtime code path, so the number is recorded for the record only. The head median must stay within twenty five percent of the trunk median, a band wide enough that docs-only noise does not fail it.

**Review gate.** None. PR-01 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Operator lands the PR bottom-up.

## Guard numeric request fields that feed a division (PR-02)

**Depends on.** None.

**Files.**

- [ ] Edit `backend/app/schemas/route.py`.
- [ ] Edit `backend/app/services/effort_estimator.py`.
- [ ] Create `backend/tests/test_numeric_field_guards.py`.

**Build.**

- [ ] Add `Field(gt=0)` to `weight_kg` and `ftp_watts` in `EffortEstimateRequest`.
- [ ] Return zeros from `estimate_required_power` when `weight_kg` is not positive.
- [ ] Add a test that walks the app schemas and asserts every float field named like a physical quantity carries a bound.

**You see.**

- [ ] `POST /api/v1/routes/{id}/effort-estimate-custom` with `weight_kg` zero answers `422`, not `500`.
- [ ] `python -m pytest backend/tests/test_numeric_field_guards.py -q` passes at head and fails on trunk.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `backend/tests/test_numeric_field_guards.py` gains a case for the `weight_kg` zero path and a case for the schema walk. Run `python -m pytest backend/tests/test_numeric_field_guards.py -q`.
- [ ] Negative check. Remove the `Field(gt=0)` bound in a scratch copy and confirm the zero-path test fails.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Mint a token and pick a route from the integration fixtures in `backend/tests/`, then send `POST /api/v1/routes/{route_id}/effort-estimate-custom` with `Authorization: Bearer <token>` and body `{"ftp_watts": 250, "weight_kg": 0}` at trunk and head. Save `/tmp/swarm-pr-02/lane-01-regression.log`. Pass when trunk answers `500` and head answers `422`.
- [ ] Lane 2. Send a valid `weight_kg` of `75` and confirm a normal estimate returns. Save `/tmp/swarm-pr-02/lane-02-valid.log`. Pass when the response carries a nonzero `estimated_time_seconds`.
- [ ] Lane 3. Confirm the GET `/routes/{id}/effort-estimate` friendly path is unchanged when no profile exists. Save `/tmp/swarm-pr-02/lane-03-get.log`. Pass when the description string is returned.
- [ ] Lane 4. Send `ftp_watts` zero and confirm a bounded response. Save `/tmp/swarm-pr-02/lane-04-ftp.log`. Pass when the response is `422`.
- [ ] Lane 5. Run `ruff check backend/`. Save `/tmp/swarm-pr-02/lane-05-ruff.log`. Pass when it exits zero.
- [ ] Lane 6. Run `npx tsc --noEmit` in `frontend/`. Save `/tmp/swarm-pr-02/lane-06-tsc.log`. Pass when it exits zero.
- [ ] Lane 7. Run the full host unit suite. Save `/tmp/swarm-pr-02/lane-07-suite.log`. Pass when the failure count is unchanged from trunk.
- [ ] Lane 8. Walk every app schema and list float fields without a bound. Save `/tmp/swarm-pr-02/lane-08-schemas.log`. Pass when the list is limited to fields named in the test allowlist.
- [ ] Lane 9. Confirm the frontend client sends a positive weight by default. Save `/tmp/swarm-pr-02/lane-09-client.log`. Pass when the client path is unchanged.
- [ ] Lane 10. Re-run the zero path ten times and confirm a stable `422`. Save `/tmp/swarm-pr-02/lane-10-stability.log`. Pass when all ten answers match.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Custom-endpoint latency for a valid request, measured at trunk and at head.
- [ ] Probe. Run a load of one hundred valid requests at each side, interleaved three times, and take each side's median p95. Both sides must produce the number.
- [ ] Baseline. Record the trunk median p95 first.
- [ ] Rule. Head median p95 must stay within fifteen percent of trunk. A larger rise fails.

**Review gate.** None. PR-02 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Operator lands the PR bottom-up.

## Report dead code without deleting it (PR-03)

**Depends on.** None.

**Files.**

- [ ] Edit `backend/pyproject.toml`.
- [ ] Edit `frontend/package.json`.
- [ ] Create `.github/workflows/deadcode-report.yml`.

**Build.**

- [ ] Add `vulture` to the backend dev dependencies.
- [ ] Add `knip` to the frontend dev dependencies.
- [ ] Add a non-blocking report job that uploads a dead-code artifact and never fails the build.

**You see.**

- [ ] The workflow run lists a dead-code artifact and the PR check stays green.
- [ ] `python -m vulture backend/app` prints the known list without exiting nonzero in CI.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Add a test that only reads the workflow file and asserts it carries no `--error-exitcode`. The external required-check state is not assertable from the repo and is covered by lane 4. Run `python -m pytest backend/tests -q -k workflow`.
- [ ] Negative check. Add a failing exit code in a scratch copy and confirm the assertion fails.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Compare the artifact list at trunk and head. Trunk has no job, so gate the artifact the diff adds. Save `/tmp/swarm-pr-03/lane-01-regression.log`. Pass when trunk reports no artifact and head reports one.
- [ ] Lane 2. Run `python -m vulture backend/app` and capture the list. Save `/tmp/swarm-pr-03/lane-02-vulture.log`. Pass when the list includes the audit's named functions.
- [ ] Lane 3. Run `npx knip` in `frontend/`. Save `/tmp/swarm-pr-03/lane-03-knip.log`. Pass when the list includes `mode-shell` and `Reveal`.
- [ ] Lane 4. Confirm the job does not gate merge by reading the branch protection settings once. Save `/tmp/swarm-pr-03/lane-04-protection.log`. Pass when the job is not required.
- [ ] Lane 5. Run `ruff check backend/`. Save `/tmp/swarm-pr-03/lane-05-ruff.log`. Pass when it exits zero.
- [ ] Lane 6. Run `npx tsc --noEmit` in `frontend/`. Pass when it exits zero. Save `/tmp/swarm-pr-03/lane-06-tsc.log`.
- [ ] Lane 7. Run the full host unit suite. Save `/tmp/swarm-pr-03/lane-07-suite.log`. Pass when the failure count is unchanged from trunk.
- [ ] Lane 8. Confirm the artifact uploads and is downloadable. Save `/tmp/swarm-pr-03/lane-08-artifact.log`. Pass when the download succeeds.
- [ ] Lane 9. Confirm no source file changed in the diff. Save `/tmp/swarm-pr-03/lane-09-files.log`. Pass when only config files appear.
- [ ] Lane 10. Confirm the report matches the audit's dead-code list within a small delta. Save `/tmp/swarm-pr-03/lane-10-match.log`. Pass when the overlap is at least ninety percent.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Added CI minutes for the report job.
- [ ] Probe. Compare the workflow run duration at trunk and at head, interleaved twice. Both sides must produce the number.
- [ ] Baseline. Record the trunk run duration first.
- [ ] Rule. The added job must stay under a two-minute absolute budget.

**Review gate.** None. PR-03 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Operator lands the PR bottom-up.

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Reply to the operator with the wave 1 report and the wave 2 plan.

## Appendix A. Prototype evidence

No open question needed a prototype. The three decisions in the audit turn were settlement by the operator, not by a run, and they are recorded in `docs/review-2026-10-15/README.md`.

## Appendix B. Alternatives rejected

Deleting the dead code was rejected because the operator chose report-only. A CI drift gate on `types/generated.ts` was rejected for the same reason. Running the full autopilot-full landing was rejected because the operator wants to merge. The bundled execution playbooks are unavailable on this install because `bun` is missing, so the manual protocol in this document replaces them.

## Appendix C. Risks

The schema-walk test in PR-02 may flag fields that are legitimately unbounded, which is why it carries an allowlist and ships as a warn-first check. The dead-code tools in PR-03 may be slow on the first run and are non-blocking for that reason. The docs test in PR-01 reads the repo at test time, so it fails safe when the head moves.

## Appendix D. Links and reading list

Wave 2 shipped as seven PRs, being the orphan-quarantine producer, Strava climb bands, the latitude-aware proximity grid, decoupling on normalised power, the Wahoo merged count, the local weigh-in date, and the VO2max scope. Wave 3 has shipped the beat invariants (`#313`), the action-major bump (`#314`), and slice 1 of the split, which moved the schedule into `app/tasks/beat.py`. Still open are the remaining split slices, a Pushgateway decision for the process-local sync counters, and the CI smoke gate. Read `docs/review-2026-10-15/bugs.md`, `science-review.md`, `unused-features.md` and `enhancements.md` before editing. The trail is at `.audit/repo-health-2026-10-16.tsv`.
