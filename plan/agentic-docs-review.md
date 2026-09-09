# Agentic Instruction Documents — Review & Remediation Plan

> **Status**: In Progress — working through findings systematically
> **Purpose**: Document all findings from the comprehensive review of AGENTS.md, agent definitions, commands, skills, plugins, and docs. Then execute fixes.
> **Date**: 2026-09-09

---

## Source Documents Reviewed

| Document | Path | Lines |
|----------|------|-------|
| Main instruction file | `AGENTS.md` | 264 |
| OpenCode config | `opencode.json` | 92 |
| TUI config | `tui.json` | 23 |
| Agent: backend | `.opencode/agents/backend.md` | 81 |
| Agent: frontend | `.opencode/agents/frontend.md` | 76 |
| Agent: debugger | `.opencode/agents/debugger.md` | 115 |
| Agent: sync-engineer | `.opencode/agents/sync-engineer.md` | 79 |
| Agent: production | `.opencode/agents/production.md` | 100 |
| Agent: ask | `.opencode/agents/ask.md` | 29 |
| Commands (9 files) | `.opencode/commands/*.md` | 15–72 each |
| Skills (5 files) | `.opencode/skills/*/SKILL.md` | 104–186 each |
| Plugins (3 files) | `.opencode/plugins/*` | 72–251 each |
| OpenCode docs | `docs/OPENCODE.md` | 643 |
| Running docs | `docs/RUNNING.md` | 160 |
| CODEMAP x5 | various CODEMAP.md | 32–227 |
| Algorithms | `docs/algorithms.md` | 38 |
| Bugs | `docs/BUGS.md` | 592 |
| Deploy | `docs/DEPLOY.md` | 361 |
| API versioning | `docs/api-versioning.md` | 77 |
| Merge thresholds | `docs/merge-thresholds.md` | 75 |
| Project audit | `docs/PROJECT-AUDIT-2026-08-29.md` | 614 |
| Plans | `plans/*.md` (26 files) | varies |

---

## Findings by Priority

### P0 — Immediate Correctness (contradictions, staleness that misdirects) — VERIFIED

| ID | Finding | File(s) | Status | Fix |
|----|---------|---------|--------|-----|
| F0.1 | Alembic chain: AGENTS.md says →040, PROJECT-AUDIT says 038, actual is **047** | AGENTS.md:180, RUNNING.md:127, PROJECT-AUDIT:531,579 | **CONFIRMED stale** — head is 047 | Update AGENTS.md + RUNNING.md to 047 |
| F0.2 | Table count: AGENTS.md says 36, actual model classes = **38** (PushSubscription + LiftVideo added since AGENTS.md) | AGENTS.md:89, PROJECT-AUDIT:24, AGENTS.md:95-110 | **CONFIRMED stale** — AGENTS.md omits PushSubscription and LiftVideo from relationships table | Update to 38 + add missing tables to relationships |
| F0.3 | frontend.md pitfall #2 says `routes.ts` uses `NEXT_PUBLIC_API_URL` — AGENTS.md pitfall #16 says fixed | agents/frontend.md:67 | **CONFIRMED stale** — routes.ts:71 uses relative URL, grep confirms no NEXT_PUBLIC_API_URL | Remove stale pitfall #2 |
| F0.4 | BUG-086 says `downloadRouteGpx` is dead code | PROJECT-AUDIT:305 | **STALE finding** — RouteDetailPanel.tsx:5 imports and :172 calls it. NOT dead. | Note in audit doc this is resolved; AGENS.md pitfall #16 line number is wrong (223→71) |
| F0.5 | AGENTS.md pitfall #3 vs backend.md pitfall #3 differ on exec command | AGENTS.md:175, agents/backend.md:64 | **CONFIRMED contradiction** | Make backend.md say `fittrack.py exec backend` |
| F0.6 | commands/test.md uses `cd frontend && npm run test` | commands/test.md:18 | **Confirmed** — RUNNING.md §7.3 says use workdir param in OpenCode | Add workdir note |
| F0.7 | finalise/SKILL.md references `backend/tests/test_conformity.py` | finalise/SKILL.md:39 | **VERIFIED correct** — unit tests are directly in backend/tests/, no unit/ dir. FINALISE.md is accurate; PROJECT-AUDIT §3.1 is wrong (says unit/ dir exists) | No fix needed for finalise; PROJECT-AUDIT is stale (but that's a docs file, not an instruction doc) |
| F0.8 | TEST_DATABASE_URL host-pytest approach | AGENTS.md:191, RUNNING.md:90-91 | **VERIFIED valid** — docker-compose.yml publishes 5432:5432. Port is accessible from host | No fix needed — approach is correct |
| F0.9 | opencache.json allows `docker compose *'` but pitfalls say it doesn't work | opencache.json:76 | **CONFIRMED tension** — `docker compose ps`, `docker compose logs` DO work; only `docker compose exec` does NOT | Document the exception in AGENTS.md |
| F0.10 | add-ai-analysis/SKILL.md pitfall #1 says "required" vs AGENTS.md "optional" | add-ai-analysis/SKILL.md:111, AGENTS.md:185 | **CONFIRMED contradiction** | Fix skill to say optional |

### P1 — High Value, Low Risk

| ID | Finding | File(s) | Fix |
|----|---------|---------|-----|
| F1.1 | Critical Pitfalls duplicated 4× across AGENTS.md + 4 agent files with drift | AGENTS.md:171-201, agents/{backend,frontend,debugger,sync}.md | Create `docs/CRITICAL-PITFALLS.md`, replace agent copies with link |
| F1.2 | frontend.md missing 90% of documented features | agents/frontend.md | Update or archive; sync with CODEMAP |
| F1.3 | sync-engineer.md documents only 5 of 18 Celery tasks | agents/sync-engineer.md | Add missing 13 tasks |
| F1.4 | OPENCODE.md omits `agent` model config from opencode.json example | docs/OPENCODE.md:46-87 | Add the `agent` block to the documented config |
| F1.5 | Missing skill for health signals (§3.12), goal metrics (Phase 6), notifications, exporters | skills/ | Create 3-4 new skills |
| F1.16 | commands/test.md doesn't mention `workdir` param (RUNNING.md §7.3 documents this) | commands/test.md | Add note about workdir |
| F1.17 | AGENTS.md "Planned/Incomplete" section is verbose — violates "keep concise" rule | AGENTS.md:212-223 | Trim to bullet list with links |
| F1.18 | AGENTS.md pitfall #17 references `Chart.tsx:renderBrush()` — verify exists | AGENTS.md:189 | Check if renderBrush helper exists |

### P2 — Medium Effort, High Value

| ID | Finding | File(s) | Fix |
|----|---------|---------|-----|
| F2.1 | AGENTS.md is 264 lines — should split into routing index + detailed docs | AGENTS.md | Move Celery table + pitfalls to docs/, AGENTS.md becomes index |
| F2.2 | No ESLint config; `tsc --noEmit --noUnusedLocals` catches 75 errors | frontend/ | Add ESLint; fix tsc errors |
| F2.3 | CI doesn't run `npm run lint` or `tsc --noEmit` | .github/workflows/test.yml | Add to CI |
| F2.4 | CODEMAP files reference ~25 phantom functions/components | 5 CODEMAP files | Audit + remove stale references |
| F2.5 | Permission-promoter plugin could weaken security | plugins/permission-promoter.js | Add allowlist of safe patterns |
| F2.6 | add-chart/SKILL.md says "usually no frontend changes needed" but Recharts needs config | skills/add-chart/SKILL.md | Update pitfall section |

### P3 — Long-term structural

| ID | Finding | File(s) | Fix |
|----|---------|---------|-----|
| F3.1 | No automated verification that CODEMAP references exist in source | — | Add CI check |
| F3.2 | Large files: 6 backend files >500 lines, 3 frontend >1000 lines | various | Gradual refactoring |
| F3.3 | `npm audit` shows 7 vulnerabilities, not in CI | .github/workflows/ | Add to CI |

---

## Execution Order

### Phase 1 — Verify ground truth ✅ (2026-09-09)
- [x] Alembic head = 047 (was 040 in AGENTS.md, 038 in PROJECT-AUDIT — both stale)
- [x] Table count = 38 model classes (36 in AGENTS.md + PushSubscription + LiftVideo)
- [x] `downloadRouteGpx` is NOT dead code — called from RouteDetailPanel.tsx:172
- [x] `renderBrush` exists at Chart.tsx:244 (AGENTS.md pitfall #17 correct)
- [x] `routes.ts:71` not `:223` (stale line ref in AGENTS.md pitfall #16)
- [x] TEST_DATABASE_URL approach works (port 5432 published)
- [x] Unit tests directly in `backend/tests/`, no `unit/` dir (PROJECT-AUDIT §15.2 was stale)
- [x] BUG-086 numbering conflict: PROJECT-AUDIT BUG-086 (GPX) ≠ BUGS.md BUG-086 (Whoop). Renamed to BUG-089

### Phase 2 — Fix P0 contradictions ✅ (2026-09-09)
- [x] F0.1: AGENTS.md + RUNNING.md alembic chain updated to 047
- [x] F0.2: AGENTS.md "36 tables" → "38 tables"; added PushSubscription + LiftVideo to relationships table; PROJECT-AUDIT model count + migration count updated
- [x] F0.3: frontend.md pitfall #2 (stale routes.ts NEXT_PUBLIC_API_URL) removed, replaced with React Query `enabled` + AGENTS.md cross-ref
- [x] F0.4: AGENTS.md pitfall #16 line number 223→71, noted not dead code; PROJECT-AUDIT BUG-086→BUG-089, marked resolved
- [x] F0.5: backend.md pitfall #3 `docker compose run --rm` → `fittrack.py exec backend`
- [x] F0.6: commands/test.md added workdir note
- [x] F0.7: finalise/SKILL.md test paths verified correct — no change needed
- [x] F0.8: TEST_DATABASE_URL approach verified valid — no change needed
- [x] F0.9: AGENTS.md pitfall #3 clarified which docker compose commands work vs don't
- [x] F0.10: add-ai-analysis/SKILL.md pitfall #1 "required" → "optional"

### Phase 3 — Fix P1 items ✅ (2026-09-09)
- [x] F1.1: Consolidated pitfalls — backend.md, frontend.md, debugger.md, sync-engineer.md now link to AGENTS.md instead of duplicating with drift
- [x] F1.2: frontend.md comprehensively updated — architecture, conventions, pitfalls, missing features (Zustand, PWA, Modal, etc.)
- [x] F1.3: sync-engineer.md Celery task table expanded from 5 to 18 tasks, matching AGENTS.md
- [x] F1.4: OPENCODE.md `opencode.json` example now includes `agent.model` config block; permission list mentions `pytest *`
- [x] F1.16: commands/test.md added workdir note for `cd frontend` issue
- [x] F1.17: commands/add-endpoint.md: "Register router in __init__.py or main app" → specific `backend/app/main.py` example
- [x] F1.18: commands/add-page.md: verify step updated to use `npx tsc --noEmit` + workdir note
- [x] F1.16b: commands/lint.md: added frontend typecheck + CODEMAP reference
- [x] F2.6: add-chart/SKILL.md pitfalls updated with Brush + secondary axis references
- [x] debugger.md diagnostic command: `AsyncSessionLocal` → `task_session`
- [x] BUG-086 numbering conflict: PROJECT-AUDIT BUG-086 (GPX) renamed to BUG-089 (since BUGS.md already uses BUG-086 for Whoop)

### Phase 4 — Documentation cleanup ✅ (2026-09-09)
- [x] AGENTS.md Planned/Incomplete section trimmed (removed verbose per-feature descriptions, replaced with concise bullet list + plan links)
- [x] AGENTS.md table count: 36 → 38 (PushSubscription + LiftVideo added since original)
- [x] AGENTS.md relationships table: added PushSubscription + LiftVideo rows
- [x] AGENTS.md pitfall #3: clarified `docker compose` (ps/logs/port work, exec doesn't)
- [x] AGENTS.md pitfall #16: line number 223→71, added "not dead code"
- [x] docs/RUNNING.md: alembic chain 024→047
- [x] docs/PROJECT-AUDIT-2026-08-29.md: model count 20→38, migration count 39→47, test dir structure corrected
- [x] docs/PROJECT-AUDIT-2026-08-29.md: BUG-086 (GPX) → BUG-089 (resolves numbering conflict with BUGS.md)
- [x] docs/OPENCODE.md: opencode.json example now includes `agent.model` per-mode config; permission-promoter security note added
- [x] docs/merge-thresholds.md: all threshold values + scoring formula + analysis updated to current (0.55, 0.20 weight changes)
- [x] sync-engineer.md pitfall #11 reference fixed (was incorrectly #22)

### Phase 5 — Verification ✅ (2026-09-09)
- [x] All 18 Celery tasks in AGENTS.md verified to exist in scheduler.py
- [x] `downloadRouteGpx` verified NOT dead code (called from RouteDetailPanel.tsx:172)
- [x] `renderBrush` helper verified exists at Chart.tsx:244
- [x] Alembic head verified at 047
- [x] Table count verified at 38 model classes
- [x] TEST_DATABASE_URL approach verified valid (port 5432 published)
- [x] Frontend CODEMAP phantom names verified already resolved
- [x] AGENTS.md pitfall numbering verified consistent across all agent files

### Remaining (deferred by design)
- F2.1: Split AGENTS.md — decided against (270 lines, well-organized, all content necessary; splitting would create maintenance overhead + require updating ~30 pitfall cross-references across 6 agent files)
- F2.2/F2.3: Frontend ESLint + `tsc --noEmit` in CI — codebase issue, not instruction doc issue; documented in PROJECT-AUDIT as PENDING
- F3.1-F3.3: Long-term structural items (automated CODEMAP verification, file splitting, npm audit) — documented in PROJECT-AUDIT
