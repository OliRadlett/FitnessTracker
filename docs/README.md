# FitTrack documentation map

> What each doc is for, whether it is current, and which file owns each fact.
> **If you add a doc, add a row here** — `backend/tests/test_agent_docs.py`
> fails otherwise. Keep the map short; detail belongs in the doc it points at.

## Status legend

| Status | Meaning |
|---|---|
| **Current** | Maintained; code is the truth, but this doc should agree with it. |
| **Reference** | Setup/contract for a tool or provider; changes rarely. |
| **Historical** | A snapshot at a date. Do not treat it as current. |
| **Legacy** | Tooling no longer primary; kept for anyone still using it. |

## Docs

| Doc | Status | Use it for |
|---|---|---|
| [`AGENTS.md`](../AGENTS.md) | Current | The always-injected agent guide: routing, rules, architecture, conventions, pitfall index. |
| [`DSH.md`](DSH.md) | Current | How this repo runs on DeepSeek Harness: tools, delegation, skills, plugins, approvals. |
| [`RUNNING.md`](RUNNING.md) | Current | Commands, host-side tests, lint, migrations, verification by change type. |
| [`PITFALLS.md`](PITFALLS.md) | Current | Canonical numbered pitfalls (1–43). Numbering is stable. |
| [`algorithms.md`](algorithms.md) | Current | Scoring formulas, thresholds, chart registry, specialised algorithms. |
| [`ANDROID.md`](ANDROID.md) | Current | Android feature map, screen-by-screen decisions, build/test. |
| [`ANDROID-AUTH.md`](ANDROID-AUTH.md) | Reference | Google sign-in setup, verification, failure table. |
| [`JEV_TAGGING.md`](JEV_TAGGING.md) | Current | Jev free-text tags and strength-session classification. |
| [`DEPLOY.md`](DEPLOY.md) | Reference | Droplet, Caddy, CI/CD, monitoring, endpoint access policy. |
| [`R2_SETUP.md`](R2_SETUP.md) | Reference | Cloudflare R2 bucket, token, CORS and cost for lift videos. |
| [`BUGS.md`](BUGS.md) | Current | Active/deferred bugs only. |
| [`BUGS-archive.md`](BUGS-archive.md) | Historical | Fixed bugs and their lessons. |
| [`review-vs-act.md`](review-vs-act.md) | Current | The review-vs-action placement principle for UI. |
| [`route-intelligence-audit-2026-11-05.md`](route-intelligence-audit-2026-11-05.md) | Historical | Route quality/terrain/surface audit; before/after snapshot. |
| [`dsh-audit-2026-11-06.md`](dsh-audit-2026-11-06.md) | Historical | The DSH steering/context audit. |
| [`dsh-correctness-review-2026-11-06.md`](dsh-correctness-review-2026-11-06.md) | Historical | The line-by-line correctness review. |
| [`OPENCODE.md`](OPENCODE.md) | Legacy | OpenCode TUI setup; not the primary harness. |
| [`archive/`](archive/) | Historical | Superseded design audits. |
| [`review-2026-10-15/`](review-2026-10-15/), [`review-2026-11-04/`](review-2026-11-04/) | Historical | Point-in-time code reviews. |
| [`plans/README.md`](../plans/README.md) | Current | Active programme index; individual plans are snapshots. |
| `backend/app/*/CODEMAP.md`, [`frontend/src/CODEMAP.md`](../frontend/src/CODEMAP.md) | Current | Package-level orientation maps (API, models, schemas, services, frontend). |

## Source of truth

When two docs disagree, the canonical source below wins. If the fact is not
guarded, add a guard or a test rather than a second prose copy.

| Fact | Canonical source | Guard |
|---|---|---|
| Migration head | `backend/alembic/versions/*.py` revision headers + [`RUNNING.md`](RUNNING.md) | `test_doc_claims.py` |
| Table/model/relationship map | [`backend/app/models/CODEMAP.md`](../backend/app/models/CODEMAP.md) | `test_agent_docs.py` (table count) |
| Chart registry | `backend/app/api/charts.py` `CHART_REGISTRY` + [`algorithms.md`](algorithms.md) | `test_agent_docs.py` |
| API endpoints | [`backend/app/api/CODEMAP.md`](../backend/app/api/CODEMAP.md) + routers | CODEMAP audit |
| Agent rules and routing | [`AGENTS.md`](../AGENTS.md) | `test_agent_docs.py` |
| Pitfall text and numbering | [`PITFALLS.md`](PITFALLS.md) | `test_agent_docs.py` (index parity) |
| Active programmes | [`plans/README.md`](../plans/README.md) | manual |
| Plan detail | `plans/*.md` (snapshot; code wins) | manual |
| DSH tooling | [`DSH.md`](DSH.md) + [`.dsh/README.md`](../.dsh/README.md) | `test_agent_docs.py` |
| Skills | `.dsh/skills/*/SKILL.md` | `test_agent_docs.py` (frontmatter/coverage) |
| Bugs and archive counts | [`BUGS.md`](BUGS.md) + [`BUGS-archive.md`](BUGS-archive.md) | `test_agent_docs.py` |
| Deploy topology | [`DEPLOY.md`](DEPLOY.md) + `.github/workflows/` | manual |
| Route auto-merge | `backend/app/config.py` (`route_auto_merge_enabled`) | code |
| JWT lifetime | `backend/app/services/auth.py` | code |

## Verification by change type

| Change | Minimum checks |
|---|---|
| Docs/steering only | `python -m pytest backend/tests/test_doc_claims.py backend/tests/test_agent_docs.py -q` (the steering-link guard covers the core docs) |
| Backend code | `ruff check backend/`, `python -m pytest backend/tests/ -m "not integration" -q`, relevant integration tests |
| Frontend | `npm run test`, `npx tsc --noEmit`, `npm run lint` (from `frontend/`) |
| Model or migration | `alembic downgrade <prev>` + `upgrade head`; doc-claim tests |
| Skill or `.dsh` plugin | Doc guards + `node .dsh/plugins/feature-quality/eval/{harness,wiring}.mjs` |

Full command detail and env vars: [`RUNNING.md`](RUNNING.md).

## Keeping it true

- **New doc?** Add a row here and to the routing table in [`AGENTS.md`](../AGENTS.md).
- **Doc becomes historical?** Change its status; don't delete it silently.
- **A fact lives in code?** Link to the code and add a guard if it is countable.
- **A decision will be re-litigated?** Add a line to [`DECISIONS.md`](DECISIONS.md).
- Run the doc guards before committing a documentation change.
