---
name: ssh-production-debugger
description: Debug production issues on the FitTrack Droplet via SSH — service status, backend/worker/beat logs, DB checks, Modal task verification. Use when prod misbehaves, Beat tasks go quiet, or a feature works locally but not on the server.
---

# SSH Production Debugger

Diagnose the FitTrack Droplet (`fittrack-prod`) over SSH. Read-only by default.

## Prerequisites

SSH host alias (one-time setup in `~/.ssh/config`):

```
Host fittrack-prod
    HostName oliradlett.co.uk
    User root
    IdentityFile ~/.ssh/id_rsa
    StrictHostKeyChecking accept-new
    ServerAliveInterval 60
    ServerAliveCountMax 3
```

Verify: `ssh fittrack-prod "echo ok"`. Server repo: `/opt/fitness-tracker`
(compose config + `.env` only — the app runs from GHCR images, not server code).

## Rules

1. **Read-only by default.** Never patch code on the server. Fix locally, push via
   the normal pipeline (`main` → `prod`), redeploy.
2. **Never echo secrets.** Check presence/counts only
   (e.g. `grep -c 'MODAL_TOKEN_ID' .env`), never print values.
3. Confirm real container names with `docker compose ps` first —
   names follow `fitness-tracker-<service>-1`.
4. Long commands: add `-o ServerAliveInterval=30`. Ask before any restart
   or any `exec` beyond SELECT/ping/log reads.
5. Report each step with the exact command plus the tail of its output.

## Quoting (Windows client → server shell)

PowerShell single-quoted strings expand nothing — prefer them. The Windows
`ssh` client strips double quotes in transit, so only sh **single** quotes
reach the server intact; never rely on sh double quotes. SQL string literals
inside must use the sh `'\''` sequence, which in a PowerShell single-quoted
string is written `''\''''` (each `''` collapses to one `'`). Never use `$$`
inside PowerShell double quotes — it is an automatic variable and mangles
the SQL. Where possible, dodge literals entirely (`GROUP BY sport_type`
instead of `sport_type = 'cycling'`) and dodge timestamp literals with
quoteless arithmetic (`created_at < CURRENT_DATE - 4`).

## Sandboxed agent sessions (read this first)

The agent's `pwsh` tool runs sandboxed by default, and Microsoft's `ssh.exe`
is Cygwin-based: it dies during startup when the sandbox blocks its IPC
namespace. Signature — output mentions
`cygwin1S5` + `NtCreateDirectoryObject(\BaseNamedObjects\...)` + `0xC0000022`.
That signature means sandbox confinement, not a key/server problem — do not
re-check keys, config, or flags.
Fix: run every `ssh fittrack-prod …` command in this playbook with one-shot
`danger-full-access` elevation (verified working 2026-10-08: `echo ok` →
`ok`, and step 1 returns live `docker compose ps`). Each elevated command
asks the user for approval — expect one approval per SSH step; do not batch
SSH steps into a single command to dodge approvals. No handoff bundle needed
while elevation is available.
Fallback if elevation is unavailable: `plink`/`putty` (native Win32, no
Cygwin IPC) are worth one attempt; otherwise hand the user the bundle below,
have them run it in their own terminal, and analyze the pasted output.

### Fallback handoff bundle (only if elevation is unavailable)

```bash
ssh fittrack-prod "cd /opt/fitness-tracker && docker compose ps"
ssh fittrack-prod "cd /opt/fitness-tracker && grep -c 'MODAL_TOKEN_ID' .env; grep -c 'MODAL_TOKEN_SECRET' .env"
ssh fittrack-prod "docker logs fitness-tracker-beat-1 --tail 30 2>&1"
ssh fittrack-prod "docker logs fitness-tracker-worker-1 --tail 200 2>&1 | grep -i -E 'modal|skipped|power_model|weather|segment|cross.domain' | tail -40"
ssh fittrack-prod "cd /opt/fitness-tracker && docker compose exec -T db psql -U fittrack -d fittrack -c 'SELECT COUNT(*) FROM cross_domain_insights;'"
```

Presence/counts only — no secret values. Analyze the returned text against
steps 1–7 below.

## Playbook (in order, capture output each step)

### 1. Service status

```bash
ssh fittrack-prod "cd /opt/fitness-tracker && docker compose ps"
```

All services `Up`/healthy. Note restarting, exited, or unhealthy ones.
Check the `CREATED` column first: freshly restarted containers have shallow
logs, so an empty error-grep proves nothing — calibrate depth before concluding.

### 2. Backend logs

```bash
ssh fittrack-prod "docker logs fitness-tracker-backend-1 --tail 100 2>&1"
```

### 3. Worker logs (Celery)

```bash
ssh fittrack-prod "docker logs fitness-tracker-worker-1 --tail 100 2>&1"
```

Look for task failures, connection errors, retry exhaustion.

### 4. Beat schedule (tasks not running)

```bash
ssh fittrack-prod "docker logs fitness-tracker-beat-1 --tail 50 2>&1"
ssh fittrack-prod "cd /opt/fitness-tracker && docker compose exec -T redis redis-cli llen celery"
```

### 5. Caddy logs

```bash
ssh fittrack-prod "docker logs fitness-tracker-caddy-1 --tail 50 2>&1"
```

Look for 502/504, TLS, routing problems.

### 6. DB / Redis health (read-only)

```bash
ssh fittrack-prod "cd /opt/fitness-tracker && docker compose exec -T db psql -U fittrack -d fittrack -c 'SELECT 1'"
ssh fittrack-prod "cd /opt/fitness-tracker && docker compose exec -T redis redis-cli ping"
ssh fittrack-prod "df -h / && free -h"
```

### 7. Modal task loop (quiet-Beat close-out, presence only)

```bash
ssh fittrack-prod "cd /opt/fitness-tracker && grep -c 'MODAL_TOKEN_ID' .env"
ssh fittrack-prod "cd /opt/fitness-tracker && grep -c 'MODAL_TOKEN_SECRET' .env"
ssh fittrack-prod "docker logs fitness-tracker-worker-1 --tail 200 2>&1 | grep -i -E 'modal|skipped|power_model|weather|segment|cross.domain' | tail -50"
```

Output-column spot checks (SELECT only), e.g. cross-domain row count,
`cycling_profiles.power_model_fitted_at`, `routes.terrain_classification`.

## Pitfalls

- `.env` survives deploys but needs a container restart to take effect.
- `docker compose exec` from the host works for `db`/`redis`; prefer
  `docker logs` for app services.
- A fix candidate is verified locally first, then deployed — never patched live.
