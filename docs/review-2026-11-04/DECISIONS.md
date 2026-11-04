# Decisions — 2026-11-04 audit

## D1. Audit `origin/main`, not the working checkout

The main checkout at `C:\Projects\fitness-tracker` is on `fix/beat-healthcheck`, **42 commits behind** `origin/main`, and has 13 modified files plus many untracked files from other sessions. Auditing it would produce false findings (for example, it still contains files that `origin/main` deleted in #335).

**Decision:** export `origin/main` (`d2a7fd0`) to `C:\Projects\fitness-tracker-audit-main` and audit that snapshot. The report names the commit. The local tree is never read as evidence except to locate the export.

**Consequence:** line numbers are as of `d2a7fd0`. Re-run the verifier after merging; a finding that is fixed will report `FIXED/DRIFT` rather than silently staying in the table.

## D2. Do not modify production code

The audit found P0/P1 defects. Fixing them here would be a prototype on another session's dirty tree, not a release. The standing repo rules also require a feature branch, PR, host-side tests, and a clean tree.

**Decision:** no source edits, no dependency changes, no commits, no production changes. This session produces the diagnosis, the contract, the register, and the verifier. The fixes are a separate production plan.

## D3. The artifact is the dossier, not a feature

"Full project analysis" could become a feature list. That is the anti-pattern the prompt warns about.

**Decision:** one artifact — `AUDIT.md` with `findings.json` and `qa/verify_audit.py` as its lab. The artifact gate is "every finding's evidence still reproduces"; the release gate is "no P0/P1 remains". The first passes; the second fails and drives the recommendation to iterate.

## D4. Real fixture, with a stated limitation

The prompt asks for a real production fixture. The production database was not accessed: no credential was needed for the code findings, and reading prod was not necessary to prove them.

**Decision:** use the local `fittrack` database as a **production-shaped, real-row** fixture, aggregate only: 1 user, 582 activities, 4 lifting sessions, 86 routes, 4/4 sessions with sets, 0/4 with TSS. No PII, no row dumps. The limitation is recorded in `findings.json` and `AUDIT.md`; a prod read-only check is a follow-up.

## D5. Severity and confidence

- **P0** — data loss or a dead sync path; stop the release.
- **P1** — a user-facing breakage, a cross-tenant/authorization gap, or a release-safety failure; fix before calling the release healthy.
- **P2** — correctness or quality debt that survives one release but distorts a decision.
- **P3/secondary** — real but narrower, latent, or dependent on a configuration not currently enabled.

Confidence is `high` when the evidence is a code path that can be read end-to-end or a value checked against the real fixture, `medium` when reachability depends on an unverified configuration, `low` when only a static suspicion exists. No `low` finding is in the register.

## D6. Artifact gate vs release gate

`verify_audit.py` has two exits:

- Default / `--artifact`: passes when all evidence anchors still exist. This is a snapshot integrity check.
- `--strict`: passes only when no P0/P1 finding is open. This is the release gate.

The artifact gate **passes** now; the release gate **fails**. That is intentional. A report that "passes" while P0s are open would be the same silent-success shape the audit is criticising.

## D7. Checks are evidence, not product tests

Every finding's `checks` re-read the code/config that proves it. When a bug is fixed, the check fails, which is the signal to update the report (status `FIXED/DRIFT`), not to weaken the check. The checks are not intended to run as a blocking CI job until the P0/P1 set is fixed; then the release gate becomes the CI job.

## D8. Findings rejected or deferred

**Rejected as already fixed / not re-reported**

- BUG-R01 (zero `weight_kg`), BUG-R30 (`merged_count`), BUG-R31 (Whoop weigh-in date), BUG-R32 (`cos(lat)` grid) — fixed in `origin/main`.
- Orphan-route quarantine producer, UndoLog's HTTP surface, RUNNING.md's head/phantom/pitfall claims, AGENTS' "Nothing built yet" — fixed and re-verified.
- 2026-10-15 C-1/C-2 and the RUNNING inconsistencies — stale; the new register supersedes them.
- Trailing bit-rot findings from the regression pass (bogus `TrainingPlanDay` annotations under `from __future__ import annotations`) are not counted as runtime bugs.

**Rejected as false positives**

- `claim_map=0` does not 500; `ReplayResponse` defaults the budget fields.
- Session-date string comparisons are safe because the API serialises `date` as `YYYY-MM-DD`.
- All new queries in scope use `enabled: !!token`.
- No unsafe HTML in the relive/lifting surface.
- `refetchOnWindowFocus` is globally `false`, so the map is not re-initialised on window focus; the replay query only refetches on mount or explicit invalidation.

**Deferred / accepted**

- **AUD-16 — accepted residual risk.** The deployed pin is Next.js 14.2.15; a patch-only 14.2.35 upgrade is available but npm audit still flags the Next range, and only Next 16.4.5 clears it. Next 16 needs React 19 plus a broad migration. The app has no `middleware.ts` and no `next/image` import (the `/_next/image` endpoint exists but has an empty remote allowlist), so the middleware-bypass and image-optimizer advisories are not reachable; the App Router DoS/cache classes remain. Revisit as a dedicated React 19 + Next 16 project.
- Dead-code deletion (project decision is report-only).
- Full visual contact sheet and prod read-only DB check.
- Sports-science literature re-fetch; the prior review's citations are used as the reference set, and the science findings that remain are in the secondary register only.

## D9. What would change the recommendation

- **To production:** AUD-00, AUD-01, AUD-02, AUD-03, AUD-04, AUD-05, AUD-06, AUD-07 fixed; `--strict` exits 0; baseline re-run green; the P2 register triaged into a release.
- **To kill:** the P0/P1 set proves unfixable within the existing architecture (for example, the scheduler split cannot restore the auth path without a redesign), or the product's core data is already unreliable beyond repair. Neither is true today.
- **To re-scope:** fewer than 8 findings reproduce, or the audit snapshot is not the code that ships.

## D10. Git and session hygiene

No git operations were performed against the shared index. The export was created with `git archive` into a separate directory; the verifier only reads. Another session's modified files were not touched. The fix work was done in a separate worktree and merged through PRs #352, #358 and #361.

## D11. AUD-16 accepted

This is the only un-fixed finding, and it is accepted rather than open. A `next@14.2.35` patch still reports the advisory range; `npm audit` names Next 16.4.5 as the only fix. That upgrade changes React (19), routing, and cache semantics and is too broad to fold into a stabilisation release. The reachable surface is reduced by the absence of `middleware.ts` and `next/image`, but the App Router DoS/cache classes are not eliminated. The decision is reviewed at the next dependency pass; it is not a claim that the advisory is harmless.
