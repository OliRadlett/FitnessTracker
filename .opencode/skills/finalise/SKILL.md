---
name: finalise
description: Use when finishing a feature or set of changes — runs the full pre-commit, commit, push, PR, and deploy workflow for FitTrack. Covers lint, typecheck, tests, migration verification, git discipline, squash merge guidance, and CI monitoring.
---

# Finalise — Commit, Push, PR, Deploy

The end-of-work checklist: verify, commit, push, create a PR, and (when ready)
deploy to production.  Run this skill by saying *"@finalise guide me"* or
*"@finalise"* after finishing code changes.

## Git Model (quick recap)

- **`main`** is the trunk — all feature work lands here via PR.
- **`prod`** is the release branch — auto-deploys via GitHub Actions when CI
  passes on a push to `prod`.
- **Deploy = merge `main` into `prod` and push.**  Never commit directly to
  `prod`; never merge a feature branch into `prod` bypassing `main`.
- All changes must go through a feature branch → PR into `main` → (later)
  `main` → `prod` release merge.

## Phase 1 — Pre-Commit Checks

Before touching git at all, verify the change is clean:

```bash
# 1. Lint + format (backend)
ruff check backend/ --fix
ruff format backend/

# 2. Lint + typecheck (frontend)
cd frontend
npx tsc --noEmit
npm run lint

# 3. Unit tests (use host pytest — pitfall #19)
cd ..
$env:TEST_DATABASE_URL = "postgresql+asyncpg://fittrack:fittrack_dev@localhost:5432/fittrack_test"
python -m pytest backend/tests/test_conformity.py backend/tests/test_* -x -q

# 4. Integration tests
python -m pytest backend/tests/integration/ -x -q
```

> If the stack is running locally, target the container instead:
> `python fittrack.py exec backend pytest backend/tests/ -x --tb=short`

### Migrations

If you changed models, create and verify the migration **before committing**:

```bash
python fittrack.py exec backend alembic revision --autogenerate -m "describe change"
python fittrack.py exec backend alembic downgrade -1
python fittrack.py exec backend alembic upgrade head
```

Review the generated migration file.  Only commit the migration if the schema
change is intended for this release.

### Check for concurrent git usage (AGENTS.md Rule #2)

```bash
git status
git log --oneline -5
```

If files you didn't stage appear staged, or your staged files disappear,
**another session is manipulating git** — stop all git operations immediately
and ask the user to confirm the other session is done.

## Phase 2 — Review & Stage

```bash
git status           # see what changed
git diff --stat      # review scope
```

Stage **only files from this session**:

```bash
git add <specific files>
# Do NOT use `git add .` if other sessions may have uncommitted changes
```

## Phase 3 — Commit

Write a concise commit message matching repo style:

```
feat(conformity): sport-aware deviation text for strength sessions

- _deviation_text now accepts sport param; "You rode" → "Session was" for
  strength duration deviations
- RPE deviation shows absolute points instead of misleading percentage
- Exercises metric no longer displays counts as percentages
```

If the change touches docs (AGENTS.md, CODEMAP, etc.), update those **in the
same commit** (Rule #9).

## Phase 4 — Push & PR

```bash
# Push the feature branch (create it if needed)
git checkout main
git pull origin main
git checkout -b feature/your-short-name
git add <files>
git commit -m "type(scope): concise message

Optional body."
git push origin feature/your-short-name
```

Open a PR:

```bash
gh pr create --fill
```

Monitor CI:

```bash
gh pr checks
gh run watch <run_id>
```

**Wait for all checks to pass.**  GitHub Actions may queue for 50+ minutes
during runner shortages — monitor, don't force.

Merge the PR (squash preferred per Rule #4):

```bash
# GitHub won't let you approve your own PR, so merge directly with --admin
gh pr merge --squash --admin
```

The PR lands on `main`.  Verify with `gh pr checks` that post-merge CI is green.

## Phase 5 — Release & Deploy

Once the PR is merged into `main`:

```bash
# 1. Sync main locally
git checkout main
git pull origin main

# 2. Check the delta before merging into prod
git log --oneline origin/main..origin/prod
git diff --stat origin/main origin/prod

# 3. Fast-forward prod to main and push (triggers Deploy workflow)
git checkout prod
git merge main
git push origin prod
```

### CI Monitoring

The Deploy workflow builds GHCR images and redeploys the Droplet.  Monitor:

```bash
gh run watch
# or check GitHub Actions tab in browser
```

If CI on `prod` is stuck `queued` (GitHub Actions runner availability), the
deploy is blocked — do **not** force it; monitor `gh run watch <id>`.

### Verify Production

```bash
@production Verify the deployment succeeded — check backend logs, container health, and recent activity sync.
```

## Pitfalls

1. **`docker compose exec` doesn't work** — use `python fittrack.py exec <service> <command>`.
2. **`--prod` flag is required for production** — a bare `docker compose up` omits `docker-compose.dev.yml`, producing a mount-less frontend that serves stale chunks.
3. **CI on `prod` push may queue for 50+ minutes** during GitHub Actions runner shortages — monitor, don't force.
4. **Only commit files from this session** — never stage files modified by another session.
5. **Dev compose mounts only `backend/app` + `backend/alembic`** — `tests/` is baked into the image, so `fittrack.py exec backend pytest tests/...` runs stale tests after editing them. Rebuild or run pytest from host with `TEST_DATABASE_URL`.
6. **Never commit directly to `prod`** — all changes go through `main` first.
7. **`main` and `prod` should be content-identical between releases** — if they drift, reconcile before the next release.
