# OpenCode TUI Configuration Guide

> **Purpose**: Document all custom OpenCode features, configurations, and workflows for the FitTrack project.

## Table of Contents

1. [Overview](#overview)
2. [Configuration Files](#configuration-files)
3. [Custom Commands](#custom-commands)
4. [Skills](#skills)
5. [Subagents](#subagents)
6. [Plugins](#plugins)
7. [Workflows](#workflows)
8. [Keyboard Shortcuts](#keyboard-shortcuts)
9. [Troubleshooting](#troubleshooting)

---

## Overview

FitTrack uses OpenCode as its primary AI coding assistant. The TUI (Terminal User Interface) is configured with:

- **5 subagents** for specialized tasks
- **9 custom commands** for repetitive workflows
- **4 skills** for complex feature additions
- **1 plugin** for permission management
- **9 file references** for context awareness

### Quick Start

```bash
# Start OpenCode in the project directory
opencode

# Or with a specific model
opencode --model anthropic/claude-sonnet-4-5
```

---

## Configuration Files

### `opencode.json` (Project Config)

Main configuration file with references, permissions, and tool settings.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "instructions": ["AGENTS.md"],
  "references": {
    "backend-api": { "path": "backend/app/api/CODEMAP.md" },
    "backend-models": { "path": "backend/app/models/CODEMAP.md" },
    "backend-services": { "path": "backend/app/services/CODEMAP.md" },
    "backend-schemas": { "path": "backend/app/schemas/CODEMAP.md" },
    "frontend": { "path": "frontend/src/CODEMAP.md" },
    "algorithms": { "path": "docs/algorithms.md" },
    "bugs": { "path": "docs/BUGS.md" },
    "deploy": { "path": "docs/DEPLOY.md" },
    "plans": { "path": "plans" }
  },
  "shell": "pwsh",
  "snapshot": true,
  "compaction": { "auto": true, "prune": true, "reserved": 10000 },
  "formatter": {
    "ruff": { "command": ["ruff", "format", "$FILE"], "extensions": [".py"] }
  },
  "watcher": {
    "ignore": ["node_modules/**", "dist/**", ".git/**", "backups/**"]
  },
  "permission": {
    "bash": {
      "python fittrack.py *": "allow",
      "docker compose *": "allow",
      "npm *": "allow",
      "git *": "allow",
      "*": "ask"
    }
  }
}
```

**Key Settings:**
- `shell: "pwsh"` — Uses PowerShell on Windows
- `snapshot: true` — Enables undo/redo for file changes
- `compaction` — Auto-compacts long sessions, prunes old tool outputs
- `formatter` — Ruff for Python formatting
- `permission.bash` — Auto-allows common dev commands, prompts for others

### `tui.json` (TUI Config)

Terminal-specific settings for appearance and behavior.

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "scroll_speed": 3,
  "diff_style": "auto",
  "cursor": { "style": "block", "blinking": true },
  "mouse": true,
  "attention": {
    "enabled": true,
    "notifications": true,
    "sound": true,
    "volume": 0.4
  },
  "keybinds": {
    "leader": "ctrl+x"
  }
}
```

**Key Settings:**
- `attention.enabled` — Desktop notifications when agent needs input
- `attention.sound` — Sound alerts for permissions/questions
- `keybinds.leader` — `Ctrl+X` prefix for shortcuts

---

## Custom Commands

All commands are in `.opencode/commands/`. Type `/commandname` in the TUI.

### `/add-endpoint`
**Purpose**: Interactive wizard to add a new API endpoint.
**What it does**:
1. Asks for endpoint name, HTTP method, description
2. Creates route handler in `backend/app/api/`
3. Creates service function in `backend/app/services/`
4. Creates Pydantic schema in `backend/app/schemas/`
5. Registers router in `backend/app/main.py`
6. Runs linter

### `/add-page`
**Purpose**: Interactive wizard to add a new frontend page.
**What it does**:
1. Asks for page name, route path, description
2. Creates `page.tsx` in `frontend/src/app/(app)/`
3. Adds nav item to `Sidebar.tsx`
4. Creates API client in `frontend/src/lib/api/`
5. Verifies build

### `/allow`
**Purpose**: Add a bash command pattern to the permanent allow-list.
**Usage**:
```
/allow docker compose logs *
/allow pytest *
```
**What it does**: Updates `opencode.json` permission.bash section.

### `/backup`
**Purpose**: Trigger a database backup.
**What it does**: Runs `backup_database.delay()` via Celery, with pg_dump fallback.

### `/check`
**Purpose**: Quick health check of the backend.
**What it does**:
1. Verifies FastAPI app loads
2. Tests DB connection
3. Checks backend logs for errors

### `/lint`
**Purpose**: Run Ruff linting and formatting on backend code.
**What it does**:
1. `ruff check backend/ --fix`
2. `ruff format backend/`
3. Reports remaining issues

### `/migrate`
**Purpose**: Create and apply an Alembic database migration.
**Usage**:
```
/migrate add user preferences table
```
**What it does**:
1. Generates migration via `alembic revision --autogenerate`
2. Applies via `fittrack.py migrate`
3. Verifies with `alembic current`

### `/status`
**Purpose**: Check status of all Docker services.
**What it does**: Runs `python fittrack.py status` or `docker compose ps`.

### `/test`
**Purpose**: Run backend and frontend test suites.
**What it does**:
1. `pytest backend/tests/`
2. `npm run test -- --run`
3. Reports pass/fail counts

---

## Skills

Skills are reusable instruction sets for complex tasks. Located in `.opencode/skills/`.

### `add-ai-analysis`
**Purpose**: Add Gemini-powered AI analysis endpoints.
**When to use**: Adding new LLM analysis features.
**Covers**:
- Context compilation for Gemini API
- Gemini API call and response handling
- LlmAnalysis model storage
- API endpoint (GET + POST)
- Frontend AnalysisCard component
- Pitfalls: GEMINI_API_KEY, rate limiting, token limits

### `add-chart`
**Purpose**: Add new chart visualizations to the dashboard.
**When to use**: Adding new data visualizations.
**Covers**:
- Backend ChartService method
- CHART_REGISTRY registration
- ChartData format (5 chart types)
- Reference areas for zone coloring
- Frontend generic `<Chart>` component
- Pitfalls: backend returns data, query keys, performance

### `add-integration`
**Purpose**: Add new OAuth provider integrations.
**When to use**: Adding Strava-like integrations (Garmin, TrainingPeaks, etc.).
**Covers**:
- Backend service (6 functions)
- OAuthConnection model
- API endpoints (authorize + callback)
- Celery sync task
- Frontend settings card
- Pitfalls: redirect_uri, token refresh, encrypted tokens

### `ssh-production-debugger`
**Purpose**: Debug production issues via SSH.
**When to use**: Investigating live server problems.
**Covers**:
- SSH config setup
- Remote command pattern
- 8-step diagnostic playbook
- Common scenarios (feature not working, high error rate, Celery issues)
- Pitfalls: SSH timeouts, env differences

---

## Subagents

Specialized agents for different domains. Use `@agentname` in prompts.

### `@backend`
**Purpose**: Backend Python/FastAPI specialist.
**Use for**: API routes, services, models, migrations, Celery tasks.
**Bash permissions**: `python fittrack.py exec/logs/restart backend*`, `ruff*`, `alembic*`

**Example**:
```
@backend Add a new endpoint for user preferences following the pattern in @backend/app/api/activities.py
```

### `@frontend`
**Purpose**: Frontend Next.js specialist.
**Use for**: React components, pages, API clients, Tailwind, React Query.
**Bash permissions**: `npm run/install*`, `npx*`

**Example**:
```
@frontend Create a new settings page following the pattern in @frontend/src/app/(app)/settings/
```

### `@debugger`
**Purpose**: Debug errors and investigate issues.
**Use for**: Diagnosing errors, reading logs, tracing request flow.
**Bash permissions**: `python fittrack.py logs/exec/status*`, `docker compose logs/ps`

**Example**:
```
@debugger The Strava sync is failing with 401 — investigate token refresh in @backend/app/integrations/strava_client.py
```

### `@sync-engineer`
**Purpose**: OAuth/integration specialist.
**Use for**: Strava, Whoop, Wahoo, Komoot sync, Celery tasks, webhooks.
**Bash permissions**: `python fittrack.py exec/logs backend*`, `python fittrack.py restart worker beat/backend`

**Example**:
```
@sync-engineer Whoop token refresh is broken — check @backend/app/services/whoop.py and @backend/app/integrations/whoop_client.py
```

### `@production`
**Purpose**: Production debugger (SSH to Droplet).
**Use for**: Live server issues, log analysis, service status.
**Bash permissions**: `ssh fittrack-prod *` (various subcommands)

**Example**:
```
@production Users reporting 500 errors — check backend logs and verify DB connectivity
```

---

## Plugins

### `permission-promoter`
**Purpose**: Auto-promotes "Always" approved bash commands to config.
**Location**: `.opencode/plugins/permission-promoter.js`
**How it works**:
1. Listens for `permission.replied` events
2. When you click "Always", extracts the base command pattern
3. Adds `"pattern": "allow"` to `opencode.json` before the catch-all
4. Pattern persists across sessions

**Example flow**:
1. You run `docker build .`
2. OpenCode prompts: "Allow this command?"
3. You click "Always"
4. Plugin adds `"docker build *": "allow"` to config
5. Next time, no prompt

### `agent-progress`
**Purpose**: Live progress snapshot of the running agent in the TUI sidebar.
**Location**: `.opencode/plugins/agent-progress.tsx` (TUI plugin — separate target from server plugins; a single module can't be both)
**Registered in**: `tui.json` under `"plugin": [...]` (required — the auto-glob only picks up `*.ts`/`*.js`, not `.tsx`)
**Requires**: opencode >= 1.18.x (validated on 1.18.23). Uses the **undocumented TUI plugin API** (`@opencode-ai/plugin/tui`) — may break on opencode upgrades.
**What it shows** (in the right sidebar, between Context and LSP):
- Status line: working / idle / retrying / compacting
- Running tool calls with titles (`◆ edit: backend/app/api/goals.py`)
- Todo counter (`✓ 3/7 steps · current item`)
- Latest assistant text/reasoning snippet
- Warning line when a permission/question is awaiting input

**How it works**:
1. Registers a component into the `sidebar_content` slot via `api.slots.register({ order: 200, slots: {...} })`
2. Reads reactive state from `api.state.session.{messages,status,todo,permission,question}` — no polling; Solid signals re-render automatically
3. Renders nothing on fresh/empty sessions to avoid sidebar noise

**Implementation notes**:
- The host Babel-transforms external `.tsx` plugins with `babel-preset-solid` and aliases bare `solid-js` / `@opentui/solid` imports to its bundled copies — no local node_modules or tsconfig needed
- Degrades silently if the API surface moves (feature-detects `api.slots`/`api.state`)
- Tuning constants at top of file: snippet length, action title length, max shown tools

### `agent-waiting`
**Purpose**: Shows OTHER sessions (incl. subagents) blocked waiting for user input.
**Location**: `.opencode/plugins/agent-waiting.tsx` (TUI plugin)
**Registered in**: `tui.json` under `"plugin": [...]`
**What it shows**: A `Waiting N` block at the top of the sidebar (order 50, above Context) listing each blocked session with `⚠` (permission) or `?` (question) markers; click a row to switch to that session via `client.tui.selectSession`.
**How it works**:
1. Discovers sessions via `client.session.list()`, filters by non-empty `state.session.permission(id)` / `state.session.question(id)`
2. Reconciles instantly on `permission.*` / `question.*` / `session.*` bus events (`api.event.on`), plus a 20s safety interval
3. Hides rows for the displayed session (its blockers already show in the Progress widget)

---

## Workflows

### Workflow 1: First-Time Setup

```bash
# 1. Install OpenCode
npm install -g opencode-ai

# 2. Navigate to project
cd C:\Projects\fitness-tracker

# 3. Start OpenCode
opencode

# 4. Connect provider (if not already)
/connect

# 5. Verify configuration
/init  # Creates/updates AGENTS.md

# 6. Test permissions
!python fittrack.py status  # Should auto-allow
```

### Workflow 2: Daily Development

**Morning startup:**
```
# Check status
/status

# Check for any issues
/check

# Start working on tasks
I need to fix the Whoop sync issue. @debugger investigate the logs.
```

**Adding a new feature:**
```
# Use the interactive wizard
/add-endpoint

# Or delegate to specialist
@backend Add a new endpoint for user preferences
```

**Before committing:**
```
/lint
/test
```

### Workflow 3: Adding a New Integration

```
# 1. Use the skill for guidance
I want to add Garmin Connect integration. @add-integration skill guide me.

# 2. Delegate to specialist
@sync-engineer Implement Garmin OAuth flow following the Wahoo pattern

# 3. After implementation
/lint
/test
/migrate add garmin oauth connection fields
```

### Workflow 4: Debugging Issues

**Local debugging:**
```
# Quick check
/check

# Detailed investigation
@debugger The activities endpoint is returning 500 errors. Check @backend/app/api/activities.py and @backend/app/services/

# Check logs
!python fittrack.py logs backend --tail 50
```

**Production debugging:**
```
# SSH to production
@production Users reporting sync failures. Check backend logs and Redis connectivity.

# Or use the skill
I need to debug a production issue. @ssh-production-debugger guide me through the diagnostic playbook.
```

### Workflow 5: Database Changes

```
# 1. Make model changes
@backend Add a `preferences` JSON column to the User model

# 2. Create migration
/migrate add user preferences column

# 3. Verify
!python fittrack.py exec backend alembic current
```

### Workflow 6: Frontend Development

```
# 1. Use the wizard
/add-page

# 2. Or delegate
@frontend Create a new settings page for notification preferences

# 3. After implementation
!cd frontend && npm run build
```

### Workflow 7: Production Deployment

```
# 1. Ensure all tests pass
/test

# 2. Check for any pending migrations
/status

# 3. Deploy (if using CI)
!git push origin main

# 4. Verify production
@production Verify the deployment succeeded and check for errors
```

---

## Keyboard Shortcuts

### Leader Key: `Ctrl+X`

| Shortcut | Action |
|----------|--------|
| `Ctrl+X` then `L` | Session list |
| `Ctrl+X` then `N` | New session |
| `Ctrl+X` then `C` | Compact session |
| `Ctrl+X` then `M` | List models |
| `Ctrl+X` then `E` | Open editor |
| `Ctrl+X` then `X` | Export session |
| `Ctrl+X` then `U` | Undo last message |
| `Ctrl+X` then `R` | Redo message |

### Other Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+P` | Command palette |
| `Tab` | Switch agent (Build ↔ Plan) |
| `Ctrl+T` | Cycle model variants |
| `Shift+Enter` | Multiline input |
| `Ctrl+V` / `Shift+Insert` | Paste (Windows) |

### Slash Commands

| Command | Action |
|---------|--------|
| `/help` | Show help |
| `/init` | Create/update AGENTS.md |
| `/compact` | Compact session |
| `/undo` | Undo last message |
| `/redo` | Redo message |
| `/share` | Share session |
| `/new` | New session |
| `/sessions` | List sessions |
| `/models` | List models |
| `/themes` | List themes |

---

## Troubleshooting

### Paste not working on Windows
- `Ctrl+V` is fixed: explicitly bound to Windows Terminal's paste action (`"Terminal.PasteFromClipboard"` with `["ctrl+v", "ctrl+shift+v"]` in `keybindings`). WT's paste inserts clipboard text via bracketed paste, which opencode handles
- Do NOT unbind ctrl+v to "pass it through" — opencode cannot act on the raw key; only WT's paste action works
- Right-click cannot be bound to paste (no `mouse` property in current WT actions)
- Or use OpenCode Desktop app

### Commands not auto-allowed
- Check `opencode.json` permission.bash section
- Use `/allow pattern *` to add patterns

### Notifications not showing
- Verify `tui.json` has `attention.enabled: true`
- Check Windows notification settings

### Progress widget missing from sidebar
- Restart opencode (plugins load once at startup)
- Check `tui.json` still contains `"plugin": ["./.opencode/plugins/agent-progress.tsx"]`
- Widget only renders after the first exchange in a session
- If it vanished after an opencode upgrade: the TUI plugin API is undocumented and may have changed — see `.opencode/plugins/agent-progress.tsx` header notes

### Session list not showing all sessions
- Use `Ctrl+X L` to open session list
- Sessions are sorted by most recent

### Agent not finding files
- Use `@filename` to reference files
- Check that references are defined in `opencode.json`

---

## File Structure

```
fitness-tracker/
├── opencode.json              # Main config (references, permissions)
├── tui.json                   # TUI config (attention, keybinds)
├── AGENTS.md                  # Agent context guide
├── .opencode/
│   ├── agents/                # 5 subagent definitions
│   │   ├── backend.md
│   │   ├── frontend.md
│   │   ├── debugger.md
│   │   ├── production.md
│   │   └── sync-engineer.md
│   ├── commands/              # 9 custom commands
│   │   ├── add-endpoint.md
│   │   ├── add-page.md
│   │   ├── allow.md
│   │   ├── backup.md
│   │   ├── check.md
│   │   ├── lint.md
│   │   ├── migrate.md
│   │   ├── status.md
│   │   └── test.md
│   ├── skills/                # 4 skill definitions
│   │   ├── add-ai-analysis/
│   │   ├── add-chart/
│   │   ├── add-integration/
│   │   └── ssh-production-debugger/
│   └── plugins/               # 3 plugins
│       ├── permission-promoter.js
│       ├── agent-progress.tsx
│       └── agent-waiting.tsx
└── docs/
    └── OPENCODE.md            # This file
```

---

## References

- [OpenCode Docs](https://opencode.ai/docs)
- [TUI Configuration](https://opencode.ai/docs/tui)
- [Keybinds](https://opencode.ai/docs/keybinds)
- [Commands](https://opencode.ai/docs/commands)
- [Skills](https://opencode.ai/docs/skills)
- [Plugins](https://opencode.ai/docs/plugins)
- [Permissions](https://opencode.ai/docs/permissions)
