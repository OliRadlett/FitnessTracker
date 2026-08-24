---
name: ssh-production-debugger
description: Use when debugging production issues on the Droplet via SSH. Covers remote log access, container inspection, database queries, config verification, and service health checks.
---

# SSH Production Debugger

Step-by-step guide for diagnosing production issues on the FitTrack Droplet via SSH.

## Prerequisites

### SSH Config (one-time setup)

Create `~/.ssh/config` with a `fittrack-prod` host alias:

```
Host fittrack-prod
    HostName oliradlett.co.uk
    User root
    IdentityFile ~/.ssh/id_rsa
    StrictHostKeyChecking accept-new
    ServerAliveInterval 60
    ServerAliveCountMax 3
```

Verify connectivity: `ssh fittrack-prod "echo ok"`

### Project Path on Server

All commands assume the repo is at `/opt/fitness-tracker`. Confirm with:

```bash
ssh fittrack-prod "ls /opt/fitness-tracker/docker-compose.yml"
```

## Remote Command Pattern

All remote commands use this pattern:

```bash
ssh fittrack-prod "<command>"
```

For container-specific commands, use `docker compose` from the host (not `docker compose exec` — see Pitfalls):

```bash
ssh fittrack-prod "cd /opt/fitness-tracker && docker compose ps"
```

## Diagnostic Playbook

Run these steps in order when investigating a production issue. Capture output before proceeding to the next step.

### Step 1: Service Status

```bash
ssh fittrack-prod "cd /opt/fitness-tracker && docker compose ps"
```

Expected: all services `Up` with healthy status if configured. Note any containers that are restarting, exited, or unhealthy.

### Step 2: Backend Logs

```bash
ssh fittrack-prod "docker logs fitness-tracker-backend-1 --tail 100 2>&1"
```

Container names follow the pattern `fitness-tracker-<service>-1`. Verify with `docker compose ps`.

### Step 3: Worker Logs (Celery)

```bash
ssh fittrack-prod "docker logs fitness-tracker-worker-1 --tail 100 2>&1"
```

Look for: task failures, connection errors, retry exhaustion.

### Step 4: Caddy / Reverse Proxy Logs

```bash
ssh fittrack-prod "docker logs fitness-tracker-caddy-1 --tail 50 2>&1"
```

Look for: 502/504 errors, TLS issues, routing misconfigurations.

### Step 5: Database Check

```bash
ssh fittrack-prod "cd /opt/fitness-tracker && docker compose exec -T db psql -U fittrack -d fittrack -c \"SELECT version();\""
```

Quick data queries:

```bash
# Count recent activities
ssh fittrack-prod "cd /opt/fitness-tracker && docker compose exec -T db psql -U fittrack -d fittrack -c \"SELECT COUNT(*) FROM activities WHERE created_at > NOW() - INTERVAL '24 hours';\""

# Check for stuck Celery tasks
ssh fittrack-prod "cd /opt/fitness-tracker && docker compose exec -T db psql -U fittrack -d fittrack -c \"SELECT state, COUNT(*) FROM celery_taskmeta GROUP BY state;\""

# OAuth connection health
ssh fittrack-prod "cd /opt/fitness-tracker && docker compose exec -T db psql -U fittrack -d fittrack -c \"SELECT provider, expires_at, expires_at < NOW() AS expired FROM oauth_connections;\""
```

### Step 6: Environment / Config Check

```bash
# Verify key env vars exist (never echo secrets)
ssh fittrack-prod "cd /opt/fitness-tracker && grep -E '^[A-Z_]+=' .env | sed 's/=.*/=***/'"

# Check a specific var without exposing its value
ssh fittrack-prod "cd /opt/fitness-tracker && grep -c 'GEMINI_API_KEY' .env"

# Verify Caddyfile is current
ssh fittrack-prod "cat /opt/fitness-tracker/infra/Caddyfile"
```

### Step 7: Resource Pressure

```bash
ssh fittrack-prod "df -h / && free -h"
```

### Step 8: Docker Image Tags

Confirm which image versions are deployed:

```bash
ssh fittrack-prod "docker inspect fitness-tracker-backend-1 --format '{{.Config.Image}}'"
ssh fittrack-prod "docker inspect fitness-tracker-worker-1 --format '{{.Config.Image}}'"
```

## Common Production Scenarios

### Feature works locally but not in production

1. Check image tag — is it the latest build? (`docker inspect ... --format '{{.Config.Image}}'`)
2. Check env vars — is the required var set? (`grep VAR_NAME .env`)
3. Check migrations — is the DB schema current? (run Alembic check via backend container)

### High error rate / 500s

1. `docker logs --tail 200` on backend — find the traceback
2. Check DB connection: `docker compose exec -T db psql -U fittrack -d fittrack -c "SELECT 1"`
3. Check Redis: `docker compose exec -T redis redis-cli ping`
4. Check disk: `df -h`

### Celery tasks not running

1. Check worker logs for crashes
2. Check Redis for pending messages: `docker compose exec -T redis redis-cli llen celery`
3. Check Beat schedule: `docker logs fitbeat-1 --tail 20`
4. Restart worker if needed (manual intervention — commit fix and redeploy, don't patch on server)

### Slow response times

1. Check backend logs for slow query warnings
2. Check DB connections: `docker compose exec -T db psql -U fittrack -d fittrack -c "SELECT count(*) FROM pg_stat_activity"`
3. Check disk I/O: `iostat -x 1 3` (if available)

## After Identifying the Issue

1. **Do not patch on the server** — fix locally, push to `prod`, let GitHub Actions deploy
2. If you need to verify a fix candidate, test via `docker compose exec -T` on the server
3. After deploying the fix, verify with the same diagnostic steps above

## Pitfalls

1. **`docker compose exec` doesn't work on this project** — the compose file uses `docker compose run --rm <service>` for exec-like operations. For database queries, use `docker compose exec -T db psql ...` from the host directory (this works for the db service specifically)
2. **Container names use project prefix** — names follow `fitness-tracker-<service>-1` (from the directory name `/opt/fitness-tracker`). Use `docker compose ps` to find actual names before running `docker logs`
3. **GHCR images vs local code** — production runs pre-built images from `ghcr.io/oliradlett/fitnesstracker/*`. The code on the server (in `/opt/fitness-tracker`) is only used for compose config and `.env`, not for running the app
4. **`.env` persists across deploys** — changes to env vars on the server survive `git reset --hard` but require a container restart to take effect
5. **SSH timeout on long commands** — use `-o ServerAliveInterval=30` for commands that take a while, or run them in a `tmux`/`screen` session
