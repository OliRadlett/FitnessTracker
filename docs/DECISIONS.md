# Load-bearing decisions

> One line per decision that is easy to re-litigate. Each points at the doc or
> code that owns the detail; this file does **not** restate it. Append new
> decisions; mark one superseded rather than deleting it.

| ID | Decision | Why / where | Status |
|---|---|---|---|
| D1 | **DSH is the primary agent harness; OpenCode is legacy.** | [`DSH.md`](DSH.md) and [`OPENCODE.md`](OPENCODE.md) (legacy banner). The `.dsh` tree is canonical; `.opencode` is kept for anyone still using it. | Adopted 2026-11-06 |
| D2 | **`AGENTS.md` is injected every session and stays ≤ 24 KB.** Detail lives in linked docs. | [`AGENTS.md`](../AGENTS.md) budget + `test_agent_docs.py`. Routing table points to detail. | Adopted 2026-11-06 |
| D3 | **Plan documents are snapshots; code is the truth.** `plans/README.md` is the active index. | [`plans/README.md`](../plans/README.md). Status lines are corrected when work ships. | Adopted 2026-11-06 |
| D4 | **Pitfall numbering is stable.** Append new pitfalls; never renumber. | [`PITFALLS.md`](PITFALLS.md); the index in `AGENTS.md` is parity-tested. | Adopted |
| D5 | **Course → Route → Ride is the identity model.** Grouping is an `UPDATE routes SET course_id`, not a merge; course history reads `confirmed` links only. | `backend/app/models/CODEMAP.md`; [`route-courses-2026-11-05.md`](../plans/route-courses-2026-11-05.md). | Adopted (migrations 117–119) |
| D6 | **Route auto-merge is off.** The 0.82 tier marks a pair for review; it does not merge. | `route_auto_merge_enabled=False` in `config.py`; [`algorithms.md`](algorithms.md). | Adopted |
| D7 | **JWTs last 30 days; there is no refresh token; sign-in is not a gate.** | `ACCESS_TOKEN_EXPIRE_MINUTES` in `services/auth.py`; [`ANDROID-AUTH.md`](ANDROID-AUTH.md). | Adopted |
| D8 | **`/health` and `/metrics` are public by design; the data plane requires a JWT** except the auth bridge and provider webhooks, which use their own secrets/signatures. | [`DEPLOY.md`](DEPLOY.md) endpoint policy; `main.py`. | Adopted |
| D9 | **57 tables, UUID PKs; the models CODEMAP is authoritative, and every model must be registered in `app/models/__init__.py`.** | `models/CODEMAP.md`; pitfall 14; table-count guard. | Adopted |
| D10 | **DSH bundles are profile-scoped.** The files are versioned here; each profile installs them once. | [`.dsh/README.md`](../.dsh/README.md); `feature-quality` and `opencode-go-usage`. | Adopted |
| D11 | **Only commit this session's files; no bulk scripted edits; no shell in-place edits.** | `AGENTS.md` rules 1, 10, 11, 13. | Adopted |
| D12 | **Documentation claims are guarded, not trusted.** Counts, links, skill frontmatter and pitfall parity have tests. | `backend/tests/test_agent_docs.py`, `test_doc_claims.py`. | Adopted 2026-11-06 |
| D13 | **Bug IDs are identifiers, not a count.** Active bugs live in `BUGS.md`; fixed ones in the archive. | [`BUGS.md`](BUGS.md) + [`BUGS-archive.md`](BUGS-archive.md); counts are guard-checked. | Adopted 2026-11-06 |
| D14 | **No code changes on `prod`; releases merge `main` → `prod`.** | `AGENTS.md` Git & Deployment; `prod` is the only auto-deploy branch. | Adopted |

## Adding a decision

- If a choice will be argued again, add a row — not a new prose section.
- Link to the doc or code that owns the detail; do not copy it here.
- If a decision is replaced, change its status to **Superseded by D\<n\>**.
