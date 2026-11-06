# FitTrack on DeepSeek Harness (DSH)

> Canonical guide to running this repository with DSH. OpenCode still works and
> its TUI guide is kept at [`docs/OPENCODE.md`](OPENCODE.md), but DSH is the
> primary harness: commands, subagents and permissions described there do **not**
> exist here. The audit that produced this layout is
> [`dsh-audit-2026-11-06.md`](dsh-audit-2026-11-06.md).

## What DSH loads automatically

| Asset | When | Where |
|-------|------|-------|
| [`AGENTS.md`](../AGENTS.md) | Every session, in full | repo root |
| Project skills | Name + description in the session skill catalog; body only when loaded | `.dsh/skills/<name>/SKILL.md` |
| Everything else | On demand | `docs/`, CODEMAPs, `plans/` |

**The context budget is the point.** `AGENTS.md` is injected into every session,
so it stays under 24 KB and routes to detail instead of containing it. When a
fact belongs to one subsystem, put it in the relevant doc (or CODEMAP) and add a
one-line pointer here. `backend/tests/test_agent_docs.py` fails if the file
grows past the budget, if it references an OpenCode-only agent, or if a relative
link in the steering docs is broken.

## Reading discipline

1. Start with the routing table in `AGENTS.md`.
2. Read a CODEMAP before source when orienting in a package.
3. Load a skill only when its catalog description matches the task. Skills are
   instructions, not background reading.
4. Prefer `grep`/`glob`/`read` with offsets over reading a large file whole.
5. For broad codebase questions, query the graph first: `graphify query "<q>"`
   when `graphify-out/graph.json` exists.

## Tools (DSH ↔ OpenCode)

| Task | DSH tool | Notes |
|------|----------|-------|
| Read a file | `read` | `offset`/`limit` for large files; returns line numbers |
| Search contents | `grep` | ripgrep syntax; not shell `grep` |
| Find files | `glob` | not shell `find` |
| Edit | `edit` | literal replacement; preserves encoding/EOL; never shell in-place |
| Create/replace | `write` | full-file writes only |
| Shell | `pwsh` | PowerShell; pass `workdir`, don't `cd`; no bash syntax |
| Web | `web_search`, `web_fetch`, `anysearch_*` | cite URLs |
| Delegate | `subagent`, `subagent_fork` | no `@agent` syntax |
| Fan-out | `workflow` | only for many independent pieces |
| Plan | `todo_write` | multi-step tasks |
| Deliverable | `present` | Office files, PDFs, images |
| Long objective | `create_goal` / `update_goal` | survives turns; not for single tasks |

`pwsh` runs in a fresh process per call. Use its `workdir` parameter instead of
`cd`, and remember PowerShell 5.1 compatibility in scripts (`&&` is not
available; use `;` with `if ($?) { ... }`).

## Delegation

DSH has no callable named agents. A subagent starts with a fresh context, so the
prompt is the whole contract:

```
You are working in C:\Users\oradl\FitnessTracker (FitTrack).
Task: <one concrete outcome>.
Read first: <paths, CODEMAPs, plan>.
Constraints: follow AGENTS.md; do not commit; do not touch files outside <paths>.
Return: <diff summary / findings / files changed>.
```

- `subagent` — self-contained task, fresh context.
- `subagent_fork` — the child needs this conversation's context.
- Put independent delegations in one message; they run concurrently.
- Don't delegate a single-file edit or anything under ~3 tool calls.
- The old OpenCode personas (`@backend`, `@frontend`, `@debugger`,
  `@sync-engineer`, `@production`, `@ask`) survive only as prompt material in
  `.opencode/agents/*.md`. Reuse their domain rules in a subagent prompt; they
  are not invocable agents.

## Skills in this repo

| Skill | Load when |
|-------|-----------|
| `add-chart` | Adding a dashboard chart (ChartService → registry → `<Chart>`) |
| `add-ai-analysis` | Adding a Gemini-backed analysis endpoint/card |
| `add-integration` | Adding an OAuth provider integration |
| `finalise` | Finishing work: lint, typecheck, tests, commit, PR, deploy |
| `feature-quality` | Rebuilding a feature to a quality bar instead of patching |
| `graphify` | Codebase questions, graph build/query/update |
| `impeccable` | Frontend design/UX work |
| `ssh-production-debugger` | Live Droplet investigation |

`.dsh/skills/` is canonical. `.opencode/skills/` is the legacy copy used by
OpenCode; keep the shared skills in sync if you still use both (a guard test
checks that every DSH skill except `feature-quality` has an OpenCode
counterpart).

## Project plugin: feature-quality

The `/quality` command, the `/quality-status` command and their composer control
ship as a DSH bundle in
[`.dsh/plugins/feature-quality/`](../.dsh/plugins/feature-quality/README.md).
It is profile-scoped: the files are versioned here, but each DSH profile must
install it once. The current `desktop` profile links it from its `package.json`.

Four inputs are required (FEATURE, SURFACE, USER JOB, OWNER); the other seven
may stay placeholders, which the delivered prompt marks with one `UNFILLED:`
line. The control previews the exact message through the host before sending,
opens the session it created, and shows the run's deliverable ticks afterwards.
Run records live in `.dsh/plugins/feature-quality/.state/` (gitignored).

The bundle also ships the run's mechanics as repo files, so any session can call
them — installed or not:

```bash
node .dsh/plugins/feature-quality/tools/quality.mjs new "<feature>" --surface page --owner Oli
node .dsh/plugins/feature-quality/tools/quality.mjs check <slug>    # exit 1 until the run is real
node .dsh/plugins/feature-quality/tools/quality.mjs status <slug>
node .dsh/plugins/feature-quality/tools/contact-sheet.mjs --out sheet.png frames/*.png
```

`check` is evidence, not judgement: it knows the contract is filled and an
artifact exists, not whether the artifact is good. The prompt and the
`feature-quality` skill both name these tools, because a tool nobody is told
about costs the same as no tool.

Verify after changing the bundle:

```bash
node .dsh/plugins/feature-quality/eval/harness.mjs   # delivered text == prompt.md, CRLF-safe
node .dsh/plugins/feature-quality/eval/wiring.mjs    # apply(), routes, scan, client interaction
node .dsh/plugins/feature-quality/eval/tools.mjs     # quality.mjs new/check/status, contact sheet
```

All three exit non-zero on failure. Reinstalling the bundle re-imports the host half:
after the v2 reinstall, `/preview` and `/status` answered 401 (registered) where
they had answered 404 (unregistered) seconds earlier, with no app restart. An
app restart is the fallback if a host change does not take; a client-half change
(`client.js`) needs a page reload. Install/remove through `plugin_manager`
(`install_bundle` / `remove_bundle`).

## Approvals and safety

The approval policy is a session/profile setting. When it is **disabled**, any
action that would require approval is rejected automatically — do not request
sandbox escalation, and do not assume an interactive confirmation will save a
risky command.

That raises the value of the repo's own guardrails:

- `AGENTS.md` rules 1–14 are the safety net: only commit this session's files,
  stand down if another session touches the git index, no shell in-place edits,
  verify before destructive writes.
- `prod` is a release branch; never edit code on the server.
- Prefer read-only diagnosis first; state the blast radius before a destructive
  command.

## Verification

`docs/RUNNING.md` is the canonical command reference. The short version:

```powershell
# Backend tests: host-side, from backend/, with CI env vars (pitfall 23)
python -m pytest backend/tests/ -q

# Frontend
npm run test --prefix frontend
npx tsc --noEmit --project frontend

# Lint/format
ruff check backend/ --fix
ruff format backend/
```

Doc guards (cheap, no DB):

```powershell
python -m pytest backend/tests/test_doc_claims.py backend/tests/test_agent_docs.py -q
```

`test_doc_claims.py` checks the migration head in `docs/RUNNING.md` and that
named migration files exist. `test_agent_docs.py` checks the steering files:
size budget, no OpenCode agent references, valid skill frontmatter, resolving
relative links, DSH↔OpenCode skill coverage, the pitfall index matching
`docs/PITFALLS.md`, and the documented table count matching the models.

## Differences from OpenCode (checklist)

| OpenCode | DSH |
|----------|-----|
| `@backend` / `@frontend` / … agents | `subagent` with a self-contained prompt |
| Slash commands (`/test`, `/lint`, `/migrate`, …) | Skills + `docs/RUNNING.md`; only plugin-provided commands exist |
| `@filename` prompt references | Paths in the prompt; the GUI resolves `@` only in the user's message |
| Auto-format on save | Run `ruff format` yourself |
| Permission prompts / allowlist | Approval policy is session-level; when disabled, actions are rejected |
| TUI keybinds, plan mode (`Tab`) | Web GUI; no modal plan mode |
| `opencode.json` references | `AGENTS.md` routing table + on-demand reads |

## Maintenance

- **New fact for all sessions?** Add one line to `AGENTS.md` and the detail to a
  doc; keep the budget.
- **New subsystem doc?** Add a row to [`docs/README.md`](README.md) (the doc-index
  guard enforces it) and to the routing table in `AGENTS.md`.
- **A decision that will be re-litigated?** Add a line to
  [`docs/DECISIONS.md`](DECISIONS.md); link the owner, don't restate it.
- **New pitfall?** Append to `docs/PITFALLS.md` (never renumber) and add a
  one-line entry to the index in `AGENTS.md`.
- **New skill?** `.dsh/skills/<name>/SKILL.md` with `name` (matching the
  directory) and a trigger-oriented `description`. Add the legacy OpenCode copy
  if that harness is still in use.
- **New plan?** Add it to `plans/README.md` with a status line.
- Run the doc guards before committing a documentation change.
