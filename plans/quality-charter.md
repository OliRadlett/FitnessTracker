# FitTrack Quality Charter

> Status: adopted 2026-10-10. Sources: AgentTeams `fittrack-quality-programme` t1–t4 + t6 steering-poison review, integrated by architect t5. Spec only — see Next Waves for code work.
> Assumptions (locked 2026-10-10): single-user app (developer is the only athlete); analysis compares the single athlete against population benchmarks (static norms, no multi-tenant cohort infra); priority order: experience first, analyst second, coach last gated on reliability proof; current issues before frontier work; `prod` held (no `main`→`prod` ship without explicit release); model routing: frontier reasoning for architecture/review, contributor for typed execution, vision for video/3D only.

## 0. Precedence

Tracks: data-correctness (I1–I8), reliability (R1–R7), UX polish, maintainability, steering-poison P1–P10. Background: `plans/2026-10-01-data-integrity-integration-plan.md` (Waves 0–4, §1-ships-last), AGENTS.md pitfalls 1–43. Where tracks conflict, §7 resolutions rule. Runtime posture is fail-OPEN with signal; gate posture is fail-CLOSED. Never confuse the two.

## 1. Sequencing — data-correctness first, §1 verdict last

1.1 Wave-0 unblockers first: TSS-on-import + provenance guard + partial index + auth-stale banner spec. Rationale (integration-plan §2.1): §1's verdict makes numbers MORE persuasive — shipping it over incomplete load history (`tss=None` skipped rows) makes wrong numbers authoritative. Strictly worse than shipping late.
1.2 Then: dedupe/quarantine correctness + re-sync regrowth suite → merge/enrich paths + webhook drain ordering → Postgres round-trip invariants → composite verdict LAST, over complete data, with constant-row-count tests snapshotted AFTER the §5 row population (never before — plan §2.4).
1.3 UX and maintainability gates ride every wave: each wave's diff must pass portal/SW/enabled-token/honest-state checks and ownership/batch/docs checks. They are not a final wave.

## 2. Shared Definition of Done (requirements → implementation → verification → review → integration)

- REQUIREMENTS: names the invariant/rule + failing-test-first acceptance + enforcement file/test. A SHOULD without a named gate is advisory and labelled so.
- IMPLEMENTATION: one small change, verify, proceed; ≤5 files/batch with `git diff --stat` + ≥2-file spot-read between batches; Edit tool only, no shell in-place source edits; host-side backend tests with CI env (`cd backend && python -m pytest`), never exec-container pytest.
- VERIFICATION: named pinning test red-before/green-after (mutation-verified where feasible); Postgres-visible properties asserted via round-trip/raw-SQL, never in-process objects alone; route changes carry decorator-index-order tests for colliding single-segment shapes only.
- REVIEW: ownership respected (git-status-first, contention = stop); reviewer checks cross-track conflict list §7.
- INTEGRATION: migration round-trip (downgrade/upgrade) + dialect-type test green + no applied migration edited + single head; docs-in-same-change for CODEMAPs, follow-up commit for prose.

## 3. Track A — data-correctness (condensed)

I1 provenance-over-mutable-fields for identity/purge (`activity_sources.provider`, never `activities.source`); `_MERGE_FIELDS` carries `sport_type`. I2 identical-geometry gate before fuzzy dedupe; quarantine = set-aside; every new exclude-filter answers "what else must reach the excluded set". I3 JSONB-clear = SQL NULL via `none_as_null` on the 5 road/terrain columns only, raw-SQL round-trip proof. I4 PARTIAL unique index on nullable dedup keys. I5 enrich-after-lookup must eager-load (`selectinload`). I6 JSONB payloads: `json.dumps` at record time + UUID coercion in restorers, proven off re-read rows. I7 merge priority total (Strava>Wahoo>Komoot, NULL-fill + allowlist). I8 import TSS completeness + idempotent backfill; gates §1. Rejected/deferred: CSV import + exercise→FK rejected; offline reads deferred.

## 4. Track B — reliability (condensed)

R1 fail-open contract: degrade open + warning log + `available:false` + reason; never silent success/empty/500. R2 per-component degrade with CONSTANT row count; outer guard nulls verdict, never 500s. R3 auth-sync freshness: stale-backendToken surfaces as banner + manual Retry bypassing the 3600s backoff; 401s classified (stale vs authz). R4 single hardened token-refresh path (FOR UPDATE, immediate commit, force-retry-once, typed errors). R5 webhook POST only verifies+queues; Celery owns drain (50/run, 5 attempts, auth-abort); weekly reconcile owns drift (bounded window). R6 Beat owns WHEN (single schedule source, every entry expires); workers own EXECUTION under guarded locks (`skipped_lock` on contention, fail-open unlocked on outage). R7 rate-limit/client-IP fail-open; XFF only from trusted peer, right-most entry.

## 5. Track C — UX polish (condensed, experience-first for one athlete)

Review-vs-act: new viz defaults review-side (URL-state tab); labeled zones; floating action layer; viz files import ZERO mutations (grep gate); shared hooks suggest-only. Portal-to-body mandatory; no bespoke overlays. SW `/api/v1/` fetch-only + Response-in-catch, `CACHE_NAME` bump on any SW fix. `enabled:!!token` on every auth query; eager core data, IntersectionObserver-gating banned for essentials. States: ErrorState+Retry for every `isError` (never 'no data' for failures); honest EmptyState (what+how+CTA); shape-matched skeletons; plain-language mutation errors. Floors: 44px targets, 12px ticks, tabular-nums, reduced-motion, lucide-only. Population comparison shown as static-benchmark context (percentiles/norms versioned in repo), never as second-athlete rows.

## 6. Track D — maintainability (condensed)

Ownership: git-status-before-touch; contention = stop-all-git + tell user; high-blast-radius ops only on clean tree; feature→main→prod discipline; fetch+log instead of blind checkout+pull. Batches: one change→verify→proceed; ≤5 files; no bulk rewrites; stop after 2 failures, ask once. Docs: CODEMAP + export-list + codegen duties in SAME change; prose may follow in same-session follow-up commit. Types: api→services→models layering, no FastAPI DI in services, no raw SQL, async everywhere (Celery = asyncio.run+task_session); Pydantic v2 `from_attributes`; frontend client/relative-URL/portal/route-shape rules; Modal stdlib-only scope + `add_local_file` mounts + 501-without-creds. Migrations: forward-only, headers-over-filenames, branch-start collision check (`git ls-tree origin/main backend/alembic/versions/`), dialect imports (`postgresql.JSONB`), provenance predicates, per-migration round-trip verify. Single-user assumption: no multi-tenant scale work; per-user locks protect scheduled-vs-manual overlap only.

## 7. Cross-track conflicts & resolutions

C1 docs-in-same-change vs diff-bloat/crossfire: CODEMAP+export-list+codegen ride the code change; AGENTS.md/plans prose follows in same-session follow-up commit. Every SHOULD names its enforcement file/test or is labelled advisory. C2 fail-open runtime vs fail-closed gates coexist. C3 eager core reads vs lock/backpressure: eager = owned-data-on-mount reads only; fan-out/polling stay on-demand. C4 auth-stale banner jointly owned (reliability signal, UX surface). C5 waves are sequences of independently shippable ≤5-file batches; one migration per wave. C6 suggest-only hooks = capture intent now, side-effect later (applies to future offline-queue). C7 verdict tests against post-backfill data only. C8 compute boundaries (JSON-in/out, stdlib scope, mounts, 501s, ssr:false fallbacks) must all hold simultaneously.

## 8. Unified stop-conditions (fail the track)

U1 duplicate alembic head/revision; renumber own UNRELEASED file only; never edit applied migration. U2 backend tests via exec-container or without CI env — invalid. U3 new JSONB without postgresql dialect import / dialect-type test red. U4 new colliding single-segment static route without index-order test. U5 new model missing from `models/__init__` import AND `__all__`. U6 Postgres-visible property asserted only in-process — false-green. U7 new silent-empty state; any 401/500 where `available:false`+reason owed. U8 second refresh implementation; inline webhook processing; Beat schedule duplicated; fail-closed-on-outage; XFF without peer check. U9 git contention mid-operation — stop all git. U10 'no data' for failure; SW caching API; dialog inside `<main>`; chart importing `useMutation`.

## 9. Next waves (current issues first, frontier second)

W0 unblockers: I8 (TSS on import + backfill) + I1-provenance guard + I4 partial index + R3 banner spec + gate adds (`workflow_dispatch` to `test.yml`+`deploy.yml`, hook fail-closed on staged lint). Each independently shippable. W1 foundations: I2 + regrowth suite + I5/I7 + R5 drain tests. W2 completion: I3/I6 round-trips + R2 degrade + R6 checklist. W3 verdict last + t3 state-surface audit. Frontier (experience-first, single-user + population benchmarks) follows only after W0–W2 green: diary/open-ability + Relive film → analyst depth (personal + static percentiles) → coach pilot (suggest-only, reliability SLA before any auto-push).

## 10. Steering guardrails (P1–P10 embedded)

Prompts name target files + invariant list + pinning test. Bulk changes need diff-stat + spot-read BEFORE typecheck. CODEMAP/doc drift checked structurally. Hooks fail closed where tooling exists. Branch-start migration collision check. One writer per central file per wave. Model routing: frontier reasoning for architecture/review, contributor for typed execution inside invariants, vision for video/3D only, fast/cheap for docs summaries.
