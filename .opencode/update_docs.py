#!/usr/bin/env python3
"""Re-apply docs/OPENCODE.md updates."""

with open('docs/OPENCODE.md', 'r', encoding='utf-8') as f:
    content = f.read()

changes = 0

# 1. Update overview section
old_overview = """- **6 subagents** for specialized tasks
- **9 custom commands** for repetitive workflows
  - **5 skills** for complex feature additions
- **3 plugins** for permission management and TUI enhancements
- **11 references** for context awareness"""

new_overview = """- **6 subagents** for specialized tasks
- **9 custom commands** for repetitive workflows
  - **5 domain-specific skills** for FitTrack features (`add-chart`, `add-ai-analysis`, `add-integration`, `finalise`, `ssh-production-debugger`)
- **14 Superpowers skills** for SDLC methodology (brainstorming to TDD to subagent development to code review to branch finishing)
- **`graphify` skill** — local codebase knowledge graph (10,317 nodes, 27,069 edges)
- **`impeccable` skill** — 61-rule frontend design anti-pattern detector (ready for UI redesign)
- **3 TUI plugins** for permission management and progress tracking
- **1 Superpowers plugin** (OpenCode V2 plugins config)
- **11 references** for context awareness"""

if old_overview in content:
    content = content.replace(old_overview, new_overview, 1)
    changes += 1
    print("1. Overview updated")
else:
    print("1. Overview: SKIP")

# 2. Update finalise skill description
old_finalise = "**Purpose**: End-of-work checklist -- commit, push, PR, and deploy.\n**When to use**: Finishing a feature or set of changes.\n**Covers**:\n- Pre-commit checks: lint, typecheck, tests, migration verification\n- Git discipline: status review, staging only session files\n- Commit + push + PR creation\n- Release deploy: merge main to prod, monitor CI\n- Pitfalls: concurrent git sessions, CI queue delays, stale test images"

new_finalise = "**Purpose**: End-of-work checklist -- commit, push, PR, and deploy, now with Superpowers integration.\n**When to use**: Finishing a feature or set of changes.\n**Covers**:\n- **Phase 1**: Pre-commit checks (lint, typecheck, tests, migration verification)\n- **Phase 2**: Pre-PR code review (from Superpowers requesting-code-review) -- severity-tiered checklist\n- **Phase 2b**: Verification before completion (from Superpowers verification-before-completion) -- run commands, confirm output\n- **Phase 3**: Review, stage (only session files), commit (AGENTS.md/docs in same commit)\n- **Phase 4**: Push, create PR, monitor CI (may queue 50+ min)\n- **Phase 5**: Release deploy -- merge main to prod, monitor deployment\n- Pitfalls: concurrent git sessions, CI queue delays, stale test images, dev mount gaps"

# Try with em-dash
old_finalise_em = "**Purpose**: End-of-work checklist \u2014 commit, push, PR, and deploy.\n**When to use**: Finishing a feature or set of changes.\n**Covers**:\n- Pre-commit checks: lint, typecheck, tests, migration verification\n- Git discipline: status review, staging only session files\n- Commit + push + PR creation\n- Release deploy: merge main \u2192 prod, monitor CI\n- Pitfalls: concurrent git sessions, CI queue delays, stale test images"

new_finalise_em = "**Purpose**: End-of-work checklist \u2014 commit, push, PR, and deploy, now with Superpowers integration.\n**When to use**: Finishing a feature or set of changes.\n**Covers**:\n- **Phase 1**: Pre-commit checks (lint, typecheck, tests, migration verification)\n- **Phase 2**: Pre-PR code review (from Superpowers `requesting-code-review`) \u2014 severity-tiered checklist\n- **Phase 2b**: Verification before completion (from Superpowers `verification-before-completion`) \u2014 run commands, confirm output\n- **Phase 3**: Review, stage (only session files), commit (AGENTS.md/docs in same commit)\n- **Phase 4**: Push, create PR, monitor CI (may queue 50+ min)\n- **Phase 5**: Release deploy \u2014 merge `main \u2192 prod`, monitor deployment\n- Pitfalls: concurrent git sessions (Rule #2), CI queue delays, stale test images, dev mount gaps"

if old_finalise in content:
    content = content.replace(old_finalise, new_finalise, 1)
    changes += 1
    print("2. Finalise skill updated (ASCII)")
elif old_finalise_em in content:
    content = content.replace(old_finalise_em, new_finalise_em, 1)
    changes += 1
    print("2. Finalise skill updated (Unicode)")
else:
    print("2. Finalise skill: SKIP")

# 3. Add plugins key to opencode.json docs
old_json = '    "ignore": ["node_modules/**", "dist/**", ".git/**", "backups/**"]\n  },\n  "permission": {'
new_json = '    "ignore": ["node_modules/**", "dist/**", ".git/**", "backups/**"]\n  },\n  "plugins": [\n    "C:\\\\Users\\\\oradl\\\\.config\\\\opencode\\\\node_modules\\\\superpowers"\n  ],\n  "permission": {'

if old_json in content:
    content = content.replace(old_json, new_json, 1)
    changes += 1
    print("3. opencode.json plugins key added")
else:
    print("3. opencode.json plugins: SKIP")

# 4. Update Key Settings
old_settings = "- `formatter` \u2014 Ruff for Python formatting\n- `permission.bash`"
new_settings = "- `formatter` \u2014 Ruff for Python formatting\n- `plugins` \u2014 V2 plugin array: Superpowers (absolute path, no tilde expansion on Windows)\n- `permission.bash`"

if old_settings in content:
    content = content.replace(old_settings, new_settings, 1)
    changes += 1
    print("4. Key Settings updated")
else:
    print("4. Key Settings: SKIP")

# 5. Update file structure skills count
old_skills_fs = "|   |--- skills/                # 5 skill definitions\n|   |   |--- add-ai-analysis/\n|   |   |--- add-chart/\n|   |   |--- add-integration/\n|   |   |--- finalise/\n|   |   |--- ssh-production-debugger/"
new_skills_fs = "|   |--- skills/                # 17+ skills (5 FitTrack + 14 Superpowers + graphify + impeccable)\n|   |   |--- add-ai-analysis/\n|   |   |--- add-chart/\n|   |   |--- add-integration/\n|   |   |--- finalise/           # enhanced with Superpowers review/verification\n|   |   |--- ssh-production-debugger/\n|   |   |--- graphify/           # knowledge graph skill (auto-generated)\n|   |   |--- impeccable/         # design anti-pattern skill (auto-generated)\n|   |   |--- [14 Superpowers skills loaded from npm package]"

if old_skills_fs in content:
    content = content.replace(old_skills_fs, new_skills_fs, 1)
    changes += 1
    print("5. File structure skills updated")
else:
    # Try without the tree chars - use simple text
    if "# 5 skill definitions" in content:
        content = content.replace("# 5 skill definitions", "# 17+ skills (5 FitTrack + 14 Superpowers + graphify + impeccable)", 1)
        changes += 1
        print("5. File structure skills count updated (simple)")
    else:
        print("5. File structure skills: SKIP")

# 6. Add Superpowers + external skills to Skills section
old_skills_marker = "## Plugins"
if old_skills_marker in content:
    # Find position - should be after agent-waiting and before Workflows
    idx = content.find(old_skills_marker)
    context = content[max(0,idx-200):idx]
    if 'Hides rows' in context or 'agent-waiting' in context:
        superpowers_skills = """### Superpowers Skills (installed via .config/opencode/node_modules/superpowers/)

FitTrack uses Superpowers (v6.x) as its primary SDLC methodology. The
`using-superpowers` bootstrap is injected at session start, which means the
skills trigger automatically before any response or action.

**Core workflow skills:**

| Skill | When to use | Replaces |
|-------|-------------|----------|
| `brainstorming` | Before any creative work | Informal design discussion |
| `writing-plans` | Before touching code on multi-step tasks | /add-endpoint, /add-page wizards |
| `test-driven-development` | Before writing implementation code | FitTrack's testing discipline |
| `subagent-driven-development` | Executing implementation plans | Manual @backend / @frontend subagent dispatch |
| `executing-plans` | Inline plan execution | Direct implementation in current session |
| `systematic-debugging` | Bug, test failure, unexpected behavior | @debugger (enhances it) |
| `dispatching-parallel-agents` | 2+ independent tasks | Manual parallel subagent dispatch |
| `requesting-code-review` | Before merging or major milestones | Manual pre-PR review |
| `receiving-code-review` | When receiving review feedback | Manual review response |
| `finishing-a-development-branch` | After implementation complete | Overlaps with `finalise` decision matrix |
| `verification-before-completion` | About to claim work is done | finalise Phase 1 verification |
| `using-git-worktrees` | Starting isolated feature work | Manual git worktree workflow |
| `diagnosing-superpowers` | Superpowers session went wrong | Diagnostic tool |
| `writing-skills` | Creating/editing skills | Meta-skill |

> **Note**: FitTrack retains its domain-specific `add-*` skills and `finalise`
> because they encode project-specific conventions (ChartService patterns,
> Gemini API integration, OAuth provider flows, and the `main -> prod` deploy
> workflow). Superpowers' `writing-plans` step is prepended to each `add-*`
> workflow for formal specification before implementation.

### `graphify`
**Purpose**: Knowledge graph for the codebase. Queries run locally via tree-sitter (zero API cost for code).
**When to use**: Any codebase question -- architecture, relationships, file navigation.
**Usage**:
- `/graphify .` -- build/update the knowledge graph
- `graphify query "<question>"` -- scoped subgraph answer (usually smaller than grep)
- `graphify path "<A>" "<B>"` -- trace the path between two concepts
- `graphify explain "<concept>"` -- focused explanation
- `graphify update .` -- incremental update after code changes
**Output**: `graphify-out/` directory (graph.json, GRAPH_REPORT.md, graph.html)

### `impeccable`
**Purpose**: Design guidance and anti-pattern detection for frontend work.
**When to use**: UI/UX work, dashboard redesigns, component design, visual quality.
**Usage**:
- `/impeccable init` -- one-time setup: gathers product context, writes `PRODUCT.md`
- `/impeccable audit` -- 61 deterministic rules for AI-generated design anti-patterns
- `/impeccable critique` -- UX design review
- `/impeccable polish` -- final pass, design system alignment
- `/impeccable live` -- live browser iteration on UI elements
**Status**: Installed, ready for use when the UI redesign begins.

## Plugins"""
        content = content[:idx] + superpowers_skills + content[idx+len(old_skills_marker):]
        changes += 1
        print("6. Superpowers skills + graphify + impeccable added")
    else:
        print("6. Superpowers skills: SKIP (wrong context)")
else:
    print("6. Superpowers skills: SKIP (## Plugins not found)")

# 7. Add Superpowers + Graphify plugins sections before Workflows
old_workflows = "## Workflows"
if old_workflows in content:
    idx = content.rfind(old_workflows)
    context = content[max(0,idx-100):idx]
    if 'Hides rows' in context:
        plugins_section = """### `superpowers` (V2 plugin)
**Purpose**: Registers all 14 Superpowers SDLC skills and injects the `using-superpowers` bootstrap at session start.
**Location**: `C:\\Users\\oradl\\.config\\opencode\\node_modules\\superpowers` (npm-installed)
**Registered in**: `opencode.json` under `plugins` (V2 format)
**How it works**: Injects the `using-superpowers` bootstrap into the first user message, and registers all skills via `ctx.skill.transform()`.

### `graphify` (V1-compatible hook)
**Purpose**: Injects a reminder to consult the knowledge graph before grepping raw files.
**Location**: `.opencode/plugins/graphify.js`
**How it works**: Prepends a one-time `[graphify]` reminder echo to the first bash command if `graphify-out/graph.json` exists.

---

## Workflows"""
        content = content[:idx] + plugins_section + content[idx+len(old_workflows):]
        changes += 1
        print("7. Superpowers + Graphify plugins section added")
    else:
        print("7. Plugins section: SKIP (wrong context)")
else:
    print("7. Plugins section: SKIP (## Workflows not found)")

# 8. Update references section
old_refs = "- [Permissions](https://opencode.ai/docs/permissions)"
new_refs = "- [Permissions](https://opencode.ai/docs/permissions)\n\n### Installed Tools\n\n- [Superpowers](https://github.com/obra/superpowers) -- SDLC methodology plugin with 14 skills. Installed via npm at `C:\\Users\\oradl\\.config\\opencode\\node_modules\\superpowers`.\n- [Graphify](https://github.com/Graphify-Labs/graphify) -- Codebase knowledge graph. `pip install graphifyy`. Graph at `graphify-out/`.\n- [Impeccable](https://github.com/pbakaus/impeccable) -- Frontend design anti-pattern detector (61 rules). `npx impeccable install --providers=opencode`.\n- [Awesome Claude Skills](https://github.com/ComposioHQ/awesome-claude-skills) -- Curated directory of 1000+ skills (reference only, not installed)."

if old_refs in content:
    content = content.replace(old_refs, new_refs, 1)
    changes += 1
    print("8. References updated")
else:
    print("8. References: SKIP")

with open('docs/OPENCODE.md', 'w', encoding='utf-8') as f:
    f.write(content)

print(f"\nTotal changes applied: {changes}/8")
