#!/usr/bin/env python3
"""
FitTrack â€” Development Service Manager

A comprehensive CLI utility for managing Docker Compose services with
continuous monitoring, per-service control, and an interactive dashboard.

Usage:
    python fittrack.py                        # Start all & show interactive menu
    python fittrack.py up                     # Start all services
    python fittrack.py up backend frontend    # Start specific services
    python fittrack.py down                   # Stop all services
    python fittrack.py restart backend        # Restart a service
    python fittrack.py status                 # Show service status once
    python fittrack.py monitor                # Continuous monitoring dashboard
    python fittrack.py logs backend           # Tail logs for a service
    python fittrack.py logs                   # Tail logs for all services
    python fittrack.py build                  # Rebuild all images
    python fittrack.py build backend          # Rebuild a specific image
    python fittrack.py migrate                # Run database migrations
    python fittrack.py ps                     # Alias for status
    python fittrack.py exec backend bash      # Execute command in a container

No external dependencies â€” uses only the Python standard library.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import signal
import subprocess
import sys
import textwrap
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# ANSI colours & helpers
# ---------------------------------------------------------------------------

class _C:
    """ANSI colour helpers. Disables colour when stdout is not a TTY."""

    _enabled = hasattr(sys.stdout, "isatty") and sys.stdout.isatty()

    RESET    = "\033[0m"
    BOLD     = "\033[1m"
    DIM      = "\033[2m"
    UNDERLINE = "\033[4m"
    RED      = "\033[31m"
    GREEN    = "\033[32m"
    YELLOW   = "\033[33m"
    BLUE     = "\033[34m"
    MAGENTA  = "\033[35m"
    CYAN     = "\033[36m"
    WHITE    = "\033[37m"
    CLEAR    = "\033[2J\033[H"  # clear screen + home cursor

    @classmethod
    def colourise(cls, code: str, text: str) -> str:
        """Wrap *text* in ANSI *code*; returns plain text when not a TTY."""
        if not cls._enabled or not code:
            return text
        return f"{code}{text}{cls.RESET}"

    @staticmethod
    def visible_len(text: str) -> int:
        """Return the visible (non-ANSI) character count of *text*."""
        return len(re.sub(r"\033\[[0-9;]*m", "", text))

    @staticmethod
    def strip(text: str) -> str:
        """Remove all ANSI escape sequences from *text*."""
        return re.sub(r"\033\[[0-9;]*m", "", text)


C = _C  # shorthand


def _pad(text: str, width: int) -> str:
    """Pad *text* to *width* visible columns, respecting ANSI codes."""
    visible = C.visible_len(text)
    padding = max(0, width - visible)
    return text + (" " * padding)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

BACKEND_HEALTH_URL = "http://localhost:8000/health"
FRONTEND_URL = "http://localhost:3000"

# Services and their health-check strategy
# Each service can have 'startup_log_probes': list of (pattern, message) tuples
# that map log output to human-readable startup states.
SERVICE_DEFS: dict[str, dict[str, Any]] = {
    "db": {
        "display": "PostgreSQL",
        "port": "5432",
        "health": "docker",
        "startup_log_probes": [
            ("database system is ready to accept connections", "PostgreSQL ready"),
        ],
    },
    "redis": {
        "display": "Redis",
        "port": "6379",
        "health": "docker",
        "startup_log_probes": [
            ("Ready to accept connections", "Redis ready"),
        ],
    },
    "backend": {
        "display": "Backend API",
        "port": "8000",
        "health": "http",
        "url": BACKEND_HEALTH_URL,
        "startup_log_probes": [
            ("Application startup complete", "Application ready"),
            ("Waiting for application startup", "Starting uvicorn"),
            ("uvicorn", "Starting uvicorn"),
        ],
    },
    "worker": {
        "display": "Celery Worker",
        "port": None,
        "health": "docker",
        "startup_log_probes": [
            ("celery@.*ready", "Worker ready"),
            ("connected to redis", "Connecting to Redis"),
            ("celery", "Starting Celery worker"),
        ],
    },
    "beat": {
        "display": "Celery Beat",
        "port": None,
        "health": "docker",
        "startup_log_probes": [
            ("beat: Starting...", "Starting Celery Beat"),
            ("celery beat", "Starting Celery Beat"),
        ],
    },
    "frontend": {
        "display": "Frontend",
        "port": "3000",
        "health": "http",
        "url": FRONTEND_URL,
        "startup_log_probes": [
            ("ready - started server", "Dev server ready"),
            ("ready in", "Dev server ready"),
            ("npm run dev", "Starting Next.js dev server"),
            ("added .* packages", "Installing node modules"),
            ("npm install", "Installing node modules"),
        ],
    },
    "caddy": {
        "display": "Caddy Proxy",
        "port": "443",
        "health": "docker",
        "startup_log_probes": [
            ("serving initial configuration", "Caddy ready"),
            ("Caddy", "Starting Caddy"),
        ],
    },
}

ALL_SERVICES = list(SERVICE_DEFS.keys())

# Status state â†’ colour mapping
STATE_COLOURS: dict[str, str] = {
    "running":    C.GREEN,
    "healthy":    C.GREEN,
    "exited":     C.RED,
    "dead":       C.RED,
    "paused":     C.YELLOW,
    "restarting": C.YELLOW,
    "created":    C.DIM,
    "starting":   C.YELLOW,
    "not created": C.DIM,
    "unknown":    C.DIM,
}

# ---------------------------------------------------------------------------
# Subprocess helpers
# ---------------------------------------------------------------------------

def _project_root() -> Path:
    """Return the project root (directory containing this script)."""
    return Path(__file__).resolve().parent


def _run(
    args: list[str],
    *,
    capture: bool = False,
    check: bool = False,
    cwd: Path | None = None,
) -> subprocess.CompletedProcess[str]:
    """Run a subprocess with sensible defaults."""
    return subprocess.run(
        args,
        capture_output=capture,
        text=True,
        cwd=cwd or _project_root(),
        check=check,
    )


def _compose(*args: str, capture: bool = False, check: bool = False) -> subprocess.CompletedProcess[str]:
    """Run a ``docker compose`` command and return the result."""
    return _run(["docker", "compose", *args], capture=capture, check=check)


def _compose_bg(*args: str) -> subprocess.Popen[str]:
    """Start a ``docker compose`` command in the background (e.g. log tailing)."""
    return subprocess.Popen(
        ["docker", "compose", *args],
        cwd=_project_root(),
        text=True,
    )


# ---------------------------------------------------------------------------
# Environment / prerequisite checks
# ---------------------------------------------------------------------------

def _is_docker_running() -> bool:
    """Return True if the Docker daemon is reachable."""
    try:
        r = _run(["docker", "info"], capture=True)
        return r.returncode == 0
    except FileNotFoundError:
        return False


def _env_exists() -> bool:
    return (_project_root() / ".env").is_file()


def _copy_env_example() -> bool:
    """Copy ``.env.example`` â†’ ``.env``.  Returns True on success."""
    src = _project_root() / ".env.example"
    dst = _project_root() / ".env"
    if not src.is_file():
        return False
    shutil.copy2(src, dst)
    return True


def _http_check(url: str, timeout: float = 3.0) -> bool:
    """Return True if *url* responds with HTTP 200."""
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status == 200
    except (urllib.error.URLError, OSError, ValueError):
        return False


def _now_str() -> str:
    return datetime.now(timezone.utc).astimezone().strftime("%H:%M:%S")


# ---------------------------------------------------------------------------
# Service status
# ---------------------------------------------------------------------------

@dataclass
class ServiceStatus:
    name: str
    display: str
    state: str        # running, exited, etc.
    health: str       # healthy, unhealthy, starting, none
    status_text: str  # raw status string from Docker
    ports: str        # formatted port mappings
    up_since: str
    healthy: bool     # derived: is the service considered ready?
    port_display: str


def _get_service_statuses() -> list[ServiceStatus]:
    """Query ``docker compose ps`` and return per-service status."""
    result = _compose("ps", "--format", "json", capture=True)
    if result.returncode != 0:
        # Compose not initialised yet â€” return stubs
        return [
            ServiceStatus(
                name=svc,
                display=SERVICE_DEFS[svc]["display"],
                state="unknown",
                health="none",
                status_text="",
                ports="",
                up_since="",
                healthy=False,
                port_display=SERVICE_DEFS[svc].get("port") or "",
            )
            for svc in ALL_SERVICES
        ]

    # Parse JSON â€” Docker Compose may return a JSON array or one object per line
    containers: dict[str, dict[str, Any]] = {}
    raw = result.stdout.strip()
    if not raw:
        return [ServiceStatus(name=svc, display=SERVICE_DEFS[svc]["display"], state="not created",
                              health="none", status_text="", ports="", up_since="",
                              healthy=False, port_display=SERVICE_DEFS[svc].get("port") or "")
                for svc in ALL_SERVICES]
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        parsed = None
    if isinstance(parsed, list):
        # Newer Docker Compose: entire output is a JSON array
        items: list[Any] = parsed
    else:
        # Older Docker Compose: one JSON object per line
        items = []
        for line in raw.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                items.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    for obj in items:
        if not isinstance(obj, dict):
            continue
        svc_name: str = obj.get("Service", "")  # type: ignore[union-attr]
        if svc_name:
            containers[svc_name] = obj

    statuses: list[ServiceStatus] = []
    for svc in ALL_SERVICES:
        c = containers.get(svc, {})
        state = (c.get("State") or "not created").lower()
        health_raw = (c.get("Health") or "none").lower()
        status_text = c.get("Status") or ""

        # Derive health
        if state == "running":
            if health_raw == "healthy":
                healthy = True
            elif health_raw in ("unhealthy", "starting"):
                healthy = False
            else:
                # No Docker healthcheck defined â€” assume OK when running
                healthy = True
        else:
            healthy = False

        # Format ports
        ports_raw: list[dict[str, Any]] = c.get("Publishers") or []
        port_parts: list[str] = []
        expected_port = SERVICE_DEFS[svc].get("port")
        for p in ports_raw:
            published: int = p.get("PublishedPort", 0)
            target: int = p.get("TargetPort", 0)
            if published and target:
                if expected_port and str(published) == expected_port:
                    port_parts.append(f":{published}")
                else:
                    port_parts.append(f":{published}->{target}")

        port_display = ", ".join(port_parts) if port_parts else (expected_port or "")

        up_since = c.get("RunningFor") or ""

        statuses.append(ServiceStatus(
            name=svc,
            display=SERVICE_DEFS[svc]["display"],
            state=state,
            health=health_raw,
            status_text=status_text,
            ports=", ".join(port_parts),
            up_since=up_since,
            healthy=healthy,
            port_display=port_display,
        ))

    return statuses


def _run_http_health_checks(statuses: list[ServiceStatus]) -> list[ServiceStatus]:
    """For services with HTTP health checks, probe the URL and update *healthy*."""
    for s in statuses:
        defn = SERVICE_DEFS.get(s.name, {})
        if defn.get("health") == "http" and s.state == "running":
            url = defn.get("url", "")
            if url:
                s.healthy = _http_check(url, timeout=2.0)
    return statuses


def _probe_startup_states(statuses: list[ServiceStatus]) -> dict[str, str]:
    """Probe Docker logs for non-healthy services to determine their startup state.

    Returns a dict of service_name â†’ human-readable startup state message.
    """
    states: dict[str, str] = {}
    for s in statuses:
        if s.healthy:
            continue
        defn = SERVICE_DEFS.get(s.name, {})
        probes = defn.get("startup_log_probes", [])
        if not probes:
            continue

        try:
            result = _compose("logs", "--tail", "30", s.name, capture=True)
            if result.returncode != 0:
                continue
            log_output = result.stdout
            # Check probes in order (first match wins â€” they should be ordered from most specific to least)
            for pattern, message in probes:
                if re.search(pattern, log_output, re.IGNORECASE):
                    states[s.name] = message
                    break
        except Exception:
            continue

    return states


# ---------------------------------------------------------------------------
# Display helpers
# ---------------------------------------------------------------------------

HEADER_ART = r"""
  _____ _ _   _____             _
 |  ___(_) | |_   _|__ __ _ __| | __
 | |_  | | |   | |/ -_) _` / _` |/ /
 |  _| |_|_|   |_|\___\__,_\__,_|\_\
 |_|            Service Manager
"""


def _print_banner() -> None:
    print(C.colourise(C.CYAN + C.BOLD, HEADER_ART))


def _health_label(s: ServiceStatus) -> str:
    """Return a coloured health indicator string for *s*."""
    if s.state == "running":
        if s.healthy:
            return C.colourise(C.GREEN, "â— healthy")
        if s.health == "starting":
            return C.colourise(C.YELLOW, "â— starting")
        if s.health == "unhealthy":
            return C.colourise(C.RED, "âœ— unhealthy")
        return C.colourise(C.GREEN, "â— up")
    if s.state in ("exited", "dead"):
        return C.colourise(C.RED, "â—‹ down")
    if s.state == "not created":
        return C.colourise(C.DIM, "â”€ n/a")
    return C.colourise(C.DIM, s.state)


def _print_table(statuses: list[ServiceStatus]) -> None:
    """Print a formatted table of service statuses."""
    # Compute column widths from visible text
    name_w = max(C.visible_len(s.display) for s in statuses) + 2
    state_w = 12
    health_w = 12
    port_w = max(max(C.visible_len(s.port_display) for s in statuses), 6) + 2
    since_w = max(max(C.visible_len(s.up_since) for s in statuses), 7) + 2

    # Header
    hdr = (
        f"  {_pad('Service', name_w)}"
        f"{_pad('State', state_w)}"
        f"{_pad('Health', health_w)}"
        f"{_pad('Port', port_w)}"
        f"{_pad('Uptime', since_w)}"
    )
    total_w = name_w + state_w + health_w + port_w + since_w
    sep = "  " + "â”€" * total_w

    print()
    print(C.colourise(C.BOLD, hdr))
    print(C.colourise(C.DIM, sep))

    for s in statuses:
        state_colour = STATE_COLOURS.get(s.state, C.DIM)
        state_cell = C.colourise(state_colour, s.state)
        health_cell = _health_label(s)
        port_cell = s.port_display or C.colourise(C.DIM, "â”€")
        since_cell = s.up_since or C.colourise(C.DIM, "â”€")

        row = (
            f"  {_pad(s.display, name_w)}"
            f"{_pad(state_cell, state_w)}"
            f"{_pad(health_cell, health_w)}"
            f"{_pad(port_cell, port_w)}"
            f"{_pad(since_cell, since_w)}"
        )
        print(row)

    print()


def _print_urls() -> None:
    """Print useful development URLs."""
    print(C.colourise(C.CYAN, "  URLs:"))
    print(f"    Frontend:   {C.colourise(C.UNDERLINE, FRONTEND_URL)}")
    print(f"    Backend:    {C.colourise(C.UNDERLINE, BACKEND_HEALTH_URL.replace('/health', ''))}")
    print(f"    Swagger UI: {C.colourise(C.UNDERLINE, BACKEND_HEALTH_URL.replace('/health', '/docs'))}")
    print(f"    PostgreSQL: localhost:5432")
    print(f"    Redis:      localhost:6379")
    print()


def _print_summary(statuses: list[ServiceStatus]) -> None:
    """Print an aggregate health summary line."""
    running = sum(1 for s in statuses if s.state == "running")
    healthy = sum(1 for s in statuses if s.healthy)
    total = len(statuses)
    if healthy == total:
        print(C.colourise(C.GREEN + C.BOLD, f"  [OK] All {total} services running and healthy"))
    elif running > 0:
        print(C.colourise(C.YELLOW + C.BOLD, f"  â— {running}/{total} running, {healthy}/{total} healthy"))
    else:
        print(C.colourise(C.RED + C.BOLD, "  âœ— All services down"))
    print()


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def _ensure_env() -> bool:
    """Check that ``.env`` exists; copy from ``.env.example`` if needed."""
    if _env_exists():
        return True
    if (_project_root() / ".env.example").is_file():
        print(C.colourise(C.YELLOW, "  No .env file found. Copying from .env.example..."))
        if _copy_env_example():
            print(C.colourise(C.RED + C.BOLD, "  Created .env â€” edit it with your OAuth credentials, then re-run."))
            return False
    print(C.colourise(C.RED, "  ERROR: No .env or .env.example found."))
    return False


def _ensure_docker() -> bool:
    """Check that Docker is running."""
    if not _is_docker_running():
        print(C.colourise(C.RED + C.BOLD, "  ERROR: Docker is not running. Please start Docker Desktop first."))
        return False
    return True


def cmd_up(services: list[str] | None = None, build: bool = False) -> None:
    """Start services."""
    if not _ensure_env() or not _ensure_docker():
        return

    print(C.colourise(C.CYAN + C.BOLD, "\n  Starting FitTrack services...\n"))

    args = ["up", "-d"]
    if build:
        args.append("--build")
    if services:
        args.extend(services)

    result = _compose(*args)
    if result.returncode != 0:
        print(C.colourise(C.RED, "  âœ— Failed to start services."))
        return

    print(C.colourise(C.YELLOW, "  Waiting for services to become healthy...\n"))
    _wait_for_healthy(timeout=60)


def cmd_down(services: list[str] | None = None) -> None:
    """Stop services.  Specific services â†’ ``compose stop``; all â†’ ``compose down``."""
    if not _ensure_docker():
        return

    print(C.colourise(C.YELLOW, "\n  Stopping services...\n"))
    if services:
        # Only stop named containers (don't remove networks / volumes)
        _compose("stop", *services)
    else:
        # Full teardown
        _compose("down")
    print(C.colourise(C.GREEN, "  [OK] Services stopped.\n"))


def cmd_restart(services: list[str] | None = None) -> None:
    """Restart services."""
    if not _ensure_docker():
        return

    print(C.colourise(C.CYAN, "\n  Restarting services...\n"))
    if services:
        _compose("restart", *services)
    else:
        _compose("restart")
    print(C.colourise(C.GREEN, "  [OK] Restart complete.\n"))

    _wait_for_healthy(timeout=60)


def cmd_build(services: list[str] | None = None) -> None:
    """Rebuild Docker images."""
    if not _ensure_docker():
        return

    print(C.colourise(C.CYAN, "\n  Building images...\n"))
    args = ["build"]
    if services:
        args.extend(services)
    result = _compose(*args)
    if result.returncode == 0:
        print(C.colourise(C.GREEN, "\n  [OK] Build complete.\n"))
    else:
        print(C.colourise(C.RED, "\n  âœ— Build failed.\n"))
        return


def cmd_status(run_http_checks: bool = True) -> None:
    """Show service status once."""
    if not _ensure_docker():
        return

    statuses = _get_service_statuses()
    if run_http_checks:
        statuses = _run_http_health_checks(statuses)

    _print_banner()
    _print_table(statuses)
    _print_summary(statuses)


def cmd_ps() -> None:
    """Alias for :func:`cmd_status`."""
    cmd_status()


def cmd_logs(
    services: list[str] | None = None,
    follow: bool = True,
    tail: int = 100,
) -> None:
    """Tail service logs (Ctrl+C to stop)."""
    if not _ensure_docker():
        return

    args = ["logs"]
    if follow:
        args.append("-f")
    args.extend(["--tail", str(tail)])
    if services:
        args.extend(services)

    proc: subprocess.Popen[str] | None = None
    try:
        proc = _compose_bg(*args)
        proc.wait()
    except KeyboardInterrupt:
        if proc is not None:
            proc.terminate()
        print("\n")


def cmd_migrate() -> None:
    """Run database migrations via Alembic (uses run --rm to avoid TTY issues)."""
    if not _ensure_docker():
        return

    print(C.colourise(C.YELLOW, "\n  Running database migrations...\n"))
    result = _compose("run", "--rm", "backend", "alembic", "upgrade", "head")
    if result.returncode == 0:
        print(C.colourise(C.GREEN, "  [OK] Migrations applied.\n"))
    else:
        print(C.colourise(C.RED, "  âœ— Migration failed.\n"))
        return


def cmd_reset() -> None:
    """Full teardown, rebuild, and restart with fresh migrations.

    Stops all containers, rebuilds images, starts services, and runs
    migrations. Database data is preserved (volumes are NOT removed).
    Use after pulling new phase changes that include new migrations.
    """
    if not _ensure_env() or not _ensure_docker():
        return

    print(C.colourise(C.CYAN + C.BOLD, "\n  ðŸ”„ Full reset â€” rebuild and migrate (DB preserved)...\n"))

    # Step 1: Tear down containers (keep volumes to preserve DB data)
    print(C.colourise(C.YELLOW, "  1/4  Stopping containers..."))
    result = _compose("down", "--remove-orphans")
    if result.returncode != 0:
        print(C.colourise(C.RED, "  âœ— Teardown failed."))
        return
    print(C.colourise(C.GREEN, "  [OK] Containers stopped.\n"))

    # Step 2: Rebuild all images
    print(C.colourise(C.YELLOW, "  2/4  Rebuilding images..."))
    result = _compose("build", "--no-cache")
    if result.returncode != 0:
        print(C.colourise(C.RED, "  âœ— Build failed."))
        return
    print(C.colourise(C.GREEN, "  [OK] Images rebuilt.\n"))

    # Step 3: Start services
    print(C.colourise(C.YELLOW, "  3/4  Starting services..."))
    result = _compose("up", "-d")
    if result.returncode != 0:
        print(C.colourise(C.RED, "  âœ— Failed to start services."))
        return
    print(C.colourise(C.YELLOW, "  Waiting for services to become healthy...\n"))
    _wait_for_healthy(timeout=90)

    # Step 4: Run migrations
    print(C.colourise(C.YELLOW, "  4/4  Running migrations..."))
    result = _compose("run", "--rm", "backend", "alembic", "upgrade", "head")
    if result.returncode == 0:
        print(C.colourise(C.GREEN, "  [OK] Migrations applied.\n"))
    else:
        print(C.colourise(C.RED, "  âœ— Migration failed.\n"))
        return

    print(C.colourise(C.GREEN + C.BOLD, "  âœ“ FitTrack reset complete â€” rebuilt with latest code and migrations!\n"))


def cmd_exec(service: str, command: list[str]) -> None:
    """Execute *command* inside a new container for *service* (uses run --rm)."""
    if not _ensure_docker():
        return
    _compose("run", "--rm", service, *command)


def cmd_backup(output: str | None = None) -> None:
    """Backup the PostgreSQL database using pg_dump.

    Output is gzip-compressed by default.  Pass ``--output`` for a custom
    path (plain SQL if the name doesn't end with .gz).
    """
    if not _ensure_docker():
        return

    _project = _project_root()
    backup_dir = _project / "backups"
    backup_dir.mkdir(exist_ok=True)

    if output is None:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        output = str(backup_dir / f"fittrack_{ts}.sql.gz")

    use_gzip = output.endswith(".gz")

    print(C.colourise(C.CYAN, f"\n  Backing up database â†’ {output}\n"))

    if use_gzip:
        # pg_dump | gzip inside the db container â€” binary output, no text decode
        result = subprocess.run(
            ["docker", "compose", "exec", "-T", "db", "sh", "-c",
             "pg_dump -U ${POSTGRES_USER:-fittrack} ${POSTGRES_DB:-fittrack} | gzip"],
            cwd=_project_root(),
            capture_output=True,
        )
        if result.returncode != 0:
            print(C.colourise(C.RED, "  âœ— pg_dump failed."))
            if result.stderr:
                print(C.colourise(C.DIM, result.stderr.decode(errors="replace")[:500]))
            return
        if not result.stdout:
            print(C.colourise(C.RED, "  âœ— pg_dump returned empty output. Is the database running?"))
            return
        Path(output).write_bytes(result.stdout)
    else:
        result = subprocess.run(
            ["docker", "compose", "exec", "-T", "db",
             "pg_dump", "-U", "fittrack", "fittrack"],
            cwd=_project_root(),
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            print(C.colourise(C.RED, "  âœ— pg_dump failed."))
            if result.stderr:
                print(C.colourise(C.DIM, result.stderr[:500]))
            return
        if not result.stdout:
            print(C.colourise(C.RED, "  âœ— pg_dump returned empty output. Is the database running?"))
            return
        Path(output).write_text(result.stdout)

    size = Path(output).stat().st_size
    print(C.colourise(C.GREEN, f"  [OK] Backup saved ({size:,} bytes): {output}\n"))


def cmd_restore(backup_path: str, force: bool = False) -> None:
    """Restore the database from a backup file (gzip or plain SQL).

    **Warning**: This drops and recreates the database before loading.
    """
    path = Path(backup_path)
    if not path.is_file():
        print(C.colourise(C.RED, f"  âœ— Backup file not found: {backup_path}"))
        return

    if not force:
        print(C.colourise(C.YELLOW + C.BOLD, "\n  âš  WARNING: This will DROP and RECREATE the database!"))
        print(C.colourise(C.YELLOW, "  All current data will be lost.\n"))
        try:
            confirm = input(C.colourise(C.CYAN, "  Type 'yes' to continue: ")).strip().lower()
        except (EOFError, KeyboardInterrupt):
            print(C.colourise(C.DIM, "\n  Aborted.\n"))
            return
        if confirm != "yes":
            print(C.colourise(C.DIM, "  Aborted.\n"))
            return

    if not _ensure_docker():
        return

    use_gzip = str(path).endswith(".gz")
    print(C.colourise(C.CYAN, f"\n  Restoring database from {backup_path}\n"))

    # Step 1: Drop and recreate the database
    print(C.colourise(C.YELLOW, "  1/2  Recreating database..."))
    try:
        result = _compose(
            "exec", "-T", "db",
            "sh", "-c",
            "dropdb -U ${POSTGRES_USER:-fittrack} --if-exists ${POSTGRES_DB:-fittrack} && createdb -U ${POSTGRES_USER:-fittrack} ${POSTGRES_DB:-fittrack}",
        )
    except Exception as e:
        print(C.colourise(C.RED, f"  âœ— Failed to connect to database: {e}"))
        print(C.colourise(C.YELLOW, "  Is the database container running? Start services first with: python fittrack.py up"))
        return
    if result.returncode != 0:
        print(C.colourise(C.RED, "  âœ— Failed to recreate database. Is the db container running?"))
        if result.stderr:
            print(C.colourise(C.DIM, result.stderr[:500]))
        return

    # Step 2: Copy backup into container and restore from inside
    # (piping through stdin is very slow on Windows; docker cp is much faster)
    print(C.colourise(C.YELLOW, "  2/2  Loading backup..."))
    container_path = "/tmp/fittrack_restore"
    try:
        container_result = _compose("ps", "-q", "db", capture=True)
        container_id = container_result.stdout.strip()
        if not container_id:
            print(C.colourise(C.RED, "  Could not find db container."))
            return

        cp_result = subprocess.run(
            ["docker", "cp", str(path), f"{container_id}:{container_path}"],
            cwd=_project_root(),
            capture_output=True,
            text=True,
        )
        if cp_result.returncode != 0:
            print(C.colourise(C.RED, "  Failed to copy backup into container."))
            if cp_result.stderr:
                print(C.colourise(C.DIM, cp_result.stderr[:500]))
            return

        if use_gzip:
            restore_cmd = f"gunzip -c {container_path} | psql -U ${{POSTGRES_USER:-fittrack}} ${{POSTGRES_DB:-fittrack}} && rm -f {container_path}"
        else:
            restore_cmd = f"psql -U ${{POSTGRES_USER:-fittrack}} ${{POSTGRES_DB:-fittrack}} < {container_path} && rm -f {container_path}"

        result = _compose(
            "exec", "-T", "db",
            "sh", "-c", restore_cmd,
        )
        if result.returncode != 0:
            print(C.colourise(C.RED, "  Restore failed."))
            if result.stderr:
                print(C.colourise(C.DIM, result.stderr[:500]))
            _compose("exec", "-T", "db", "rm", "-f", container_path)
            return
    except Exception as e:
        print(C.colourise(C.RED, f"  Restore failed: {e}"))
        try:
            _compose("exec", "-T", "db", "rm", "-f", container_path)
        except Exception:
            pass
        return

    print(C.colourise(C.GREEN, "  [OK] Database restored successfully.\n"))


def cmd_monitor(interval: int = 5) -> None:
    """Continuous monitoring dashboard with live-refreshing table."""
    if not _ensure_docker():
        return

    # Mutable container so the signal handler can flip it
    _state = {"running": True}

    def _sigint_handler(sig: int, frame: Any) -> None:
        _state["running"] = False

    signal.signal(signal.SIGINT, _sigint_handler)

    # Initial clear
    if sys.stdout.isatty():
        sys.stdout.write(C.CLEAR)
        sys.stdout.flush()

    print(C.colourise(C.CYAN + C.BOLD, HEADER_ART))
    print(C.colourise(C.DIM, f"  Refreshing every {interval}s â€” press Ctrl+C to exit"))
    print()

    first_iteration = True

    while _state["running"]:
        statuses = _get_service_statuses()
        statuses = _run_http_health_checks(statuses)

        # -- Build lines -------------------------------------------------
        lines: list[str] = []

        name_w = max(C.visible_len(s.display) for s in statuses) + 2
        state_w = 12
        health_w = 14
        port_w = max(max(C.visible_len(s.port_display) for s in statuses), 6) + 2
        since_w = max(max(C.visible_len(s.up_since) for s in statuses), 7) + 2
        total_w = name_w + state_w + health_w + port_w + since_w

        # Header
        hdr = (
            f"  {_pad('Service', name_w)}"
            f"{_pad('State', state_w)}"
            f"{_pad('Health', health_w)}"
            f"{_pad('Port', port_w)}"
            f"{_pad('Uptime', since_w)}"
        )
        sep = "  " + "â”€" * total_w

        lines.append(C.colourise(C.BOLD, hdr))
        lines.append(C.colourise(C.DIM, sep))

        for s in statuses:
            state_colour = STATE_COLOURS.get(s.state, C.DIM)
            state_cell = C.colourise(state_colour, s.state)
            health_cell = _health_label(s)
            port_cell = s.port_display or C.colourise(C.DIM, "â”€")
            since_cell = s.up_since or C.colourise(C.DIM, "â”€")

            row = (
                f"  {_pad(s.display, name_w)}"
                f"{_pad(state_cell, state_w)}"
                f"{_pad(health_cell, health_w)}"
                f"{_pad(port_cell, port_w)}"
                f"{_pad(since_cell, since_w)}"
            )
            lines.append(row)

        lines.append("")

        # Summary
        running = sum(1 for s in statuses if s.state == "running")
        healthy_count = sum(1 for s in statuses if s.healthy)
        total = len(statuses)
        if healthy_count == total:
            summary = C.colourise(C.GREEN + C.BOLD, f"  [OK] All {total} services running and healthy")
        elif running > 0:
            summary = C.colourise(C.YELLOW + C.BOLD, f"  â— {running}/{total} running, {healthy_count}/{total} healthy")
        else:
            summary = C.colourise(C.RED + C.BOLD, "  âœ— All services down")
        lines.append(summary)

        # Footer
        lines.append("")
        lines.append(C.colourise(C.DIM, f"  Last updated: {_now_str()}   |   Press Ctrl+C to exit"))
        lines.append("")

        # -- Render ------------------------------------------------------
        if sys.stdout.isatty():
            sys.stdout.write(C.CLEAR)
            # Re-print banner only on first iteration when using clear-screen
            if first_iteration:
                first_iteration = False

        sys.stdout.write("\n".join(lines) + "\n")
        sys.stdout.flush()

        # Sleep in small increments so Ctrl+C is responsive
        for _ in range(interval * 10):
            if not _state["running"]:
                break
            time.sleep(0.1)

    # Restore default SIGINT behaviour
    signal.signal(signal.SIGINT, signal.default_int_handler)
    print(C.colourise(C.CYAN, "\n  Monitoring stopped.\n"))


def _wait_for_healthy(timeout: int = 60) -> None:
    """Block until all services are healthy, showing per-service startup status."""
    statuses = _get_service_statuses()
    statuses = _run_http_health_checks(statuses)

    if all(s.healthy for s in statuses):
        print(C.colourise(C.GREEN, "  [OK] All services are ready."))
        _print_urls()
        return

    spinner = "â ‹â ™â ¹â ¸â ¼â ´â ¦â §â ‡â "
    start = time.time()
    idx = 0
    last_lines_count = 0

    while time.time() - start < timeout:
        statuses = _get_service_statuses()
        statuses = _run_http_health_checks(statuses)
        startup_states = _probe_startup_states(statuses)

        if all(s.healthy for s in statuses):
            # Clear previous output
            if last_lines_count > 0:
                sys.stdout.write(f"\033[{last_lines_count}A\033[J")
            print(C.colourise(C.GREEN + C.BOLD, "  [OK] All services are ready.\n"))
            _print_urls()
            return

        elapsed = int(time.time() - start)
        ch = spinner[idx % len(spinner)]

        # Build per-service status lines
        lines: list[str] = []
        for s in statuses:
            if s.healthy:
                status_str = C.colourise(C.GREEN, "â— healthy")
            elif s.name in startup_states:
                status_str = C.colourise(C.YELLOW, f"â— {startup_states[s.name]}")
            elif s.state == "running":
                status_str = C.colourise(C.YELLOW, "â— starting...")
            elif s.state in ("exited", "dead"):
                status_str = C.colourise(C.RED, "âœ— down")
            else:
                status_str = C.colourise(C.DIM, f"â”€ {s.state}")
            name_pad = s.display.ljust(16)
            lines.append(f"  {C.colourise(C.YELLOW, ch)} {name_pad} {status_str}")

        lines.append(f"\n  {C.colourise(C.DIM, f'Elapsed: {elapsed}s â€” waiting for services...')}")

        # Clear previous output and print new
        if last_lines_count > 0:
            sys.stdout.write(f"\033[{last_lines_count}A\033[J")
        output = "\n".join(lines) + "\n"
        sys.stdout.write(output)
        sys.stdout.flush()
        last_lines_count = len(lines)

        idx += 1
        time.sleep(2)

    # Timeout reached
    if last_lines_count > 0:
        sys.stdout.write(f"\033[{last_lines_count}A\033[J")
    print(C.colourise(C.YELLOW, "  âš  Not all services became ready in time.  Check logs: python fittrack.py logs"))
    _print_urls()


# ---------------------------------------------------------------------------
# Interactive menu
# ---------------------------------------------------------------------------

_MENU_ITEMS = [
    ("1", "status",   "Show service status"),
    ("2", "monitor",  "Live monitoring dashboard"),
    ("3", "up",       "Start all services"),
    ("4", "down",     "Stop all services"),
    ("5", "restart",  "Restart all services"),
    ("6", "build",    "Rebuild all images"),
    ("7", "migrate",  "Run database migrations"),
    ("8", "reset",    "Full teardown, rebuild, and restart with migrations"),
    ("9", "logs",     "Tail all logs"),
    ("b", "backup",   "Backup the database"),
    ("r", "restore",  "Restore database from backup"),
]


def _print_menu() -> None:
    """Print the interactive command menu."""
    print(C.colourise(C.BOLD, "  Commands:"))
    for key, cmd, desc in _MENU_ITEMS:
        key_str = C.colourise(C.CYAN + C.BOLD, f"  [{key}]")
        cmd_str = C.colourise(C.WHITE + C.BOLD, f"  {cmd:<12}")
        print(f"{key_str} {cmd_str} {desc}")
    print()
    print(C.colourise(C.DIM, "  Per-service: type a command + service name"))
    print(C.colourise(C.DIM, "  e.g.:  up backend  |  logs frontend  |  restart redis"))
    print(C.colourise(C.DIM, f"  Services: {', '.join(ALL_SERVICES)}"))
    print()
    print(C.colourise(C.CYAN + C.BOLD, "  [q]") + C.colourise(C.WHITE + C.BOLD, "  quit        ") + "Exit")
    print()


def _interactive_menu() -> None:
    """Run the interactive command loop."""
    _print_banner()
    if not _ensure_docker():
        return

    while True:
        _print_menu()
        try:
            raw = input(C.colourise(C.CYAN, "  fittrack> ")).strip()
        except (EOFError, KeyboardInterrupt):
            print("\n")
            break

        if not raw:
            continue

        parts = raw.split()
        cmd = parts[0].lower()
        cmd_args = parts[1:]

        if cmd in ("q", "quit", "exit"):
            print(C.colourise(C.CYAN, "\n  Goodbye!\n"))
            break
        elif cmd in ("1", "status", "ps"):
            cmd_status()
        elif cmd in ("2", "monitor", "watch", "dash"):
            cmd_monitor()
        elif cmd in ("3", "up", "start"):
            cmd_up(cmd_args or None)
        elif cmd in ("4", "down", "stop"):
            cmd_down(cmd_args or None)
        elif cmd in ("5", "restart"):
            cmd_restart(cmd_args or None)
        elif cmd in ("6", "build"):
            cmd_build(cmd_args or None)
        elif cmd in ("7", "migrate"):
            cmd_migrate()
        elif cmd in ("8", "reset"):
            cmd_reset()
        elif cmd in ("9", "logs", "log"):
            cmd_logs(cmd_args or None)
        elif cmd in ("b", "backup"):
            cmd_backup(cmd_args[0] if cmd_args else None)
        elif cmd in ("r", "restore"):
            if not cmd_args:
                print(C.colourise(C.RED, "  Usage: restore <backup_file>"))
            else:
                cmd_restore(cmd_args[0])
        else:
            print(C.colourise(C.RED, f"  Unknown command: {cmd}"))
            print(C.colourise(C.DIM, "  Type 'q' to quit.\n"))


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="fittrack",
        description="FitTrack Development Service Manager",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=textwrap.dedent("""\
            examples:
              %(prog)s                         Interactive menu
              %(prog)s up                      Start all services
              %(prog)s up backend frontend     Start specific services
              %(prog)s down                    Stop all services
              %(prog)s restart backend         Restart backend
              %(prog)s status                  Show service status
              %(prog)s monitor                 Live monitoring dashboard
              %(prog)s logs backend            Tail backend logs
              %(prog)s build                   Rebuild all images
              %(prog)s migrate                 Run database migrations
              %(prog)s exec backend bash       Open shell in backend container
        """),
    )

    subparsers = parser.add_subparsers(dest="command")

    # up
    p_up = subparsers.add_parser("up", help="Start services")
    p_up.add_argument("services", nargs="*", default=None, help="Services to start (default: all)")
    p_up.add_argument("--build", action="store_true", help="Rebuild images before starting")
    p_up.add_argument("--migrate", action="store_true", help="Run migrations after starting")

    # down
    p_down = subparsers.add_parser("down", help="Stop services")
    p_down.add_argument("services", nargs="*", default=None,
                        help="Services to stop (default: all â€” removes containers)")

    # restart
    p_restart = subparsers.add_parser("restart", help="Restart services")
    p_restart.add_argument("services", nargs="*", default=None, help="Services to restart (default: all)")

    # build
    p_build = subparsers.add_parser("build", help="Build / rebuild Docker images")
    p_build.add_argument("services", nargs="*", default=None, help="Services to build (default: all)")

    # status / ps
    subparsers.add_parser("status", aliases=["ps"], help="Show service status")

    # monitor
    p_monitor = subparsers.add_parser("monitor", aliases=["watch", "dash"],
                                      help="Continuous monitoring dashboard")
    p_monitor.add_argument("-i", "--interval", type=int, default=5,
                           help="Refresh interval in seconds (default: 5)")

    # logs
    p_logs = subparsers.add_parser("logs", aliases=["log"], help="Tail service logs")
    p_logs.add_argument("services", nargs="*", default=None, help="Services to tail (default: all)")
    p_logs.add_argument("--no-follow", action="store_true", help="Don't follow (show last N lines and exit)")
    p_logs.add_argument("-n", "--tail", type=int, default=100, help="Number of lines to show (default: 100)")

    # migrate
    subparsers.add_parser("migrate", help="Run database migrations")

    # reset
    subparsers.add_parser("reset", help="Full teardown, rebuild, and restart with fresh migrations (wipes DB)")

    # exec
    p_exec = subparsers.add_parser("exec", help="Execute a command in a running container")
    p_exec.add_argument("service", help="Service name")
    p_exec.add_argument("exec_command", nargs=argparse.REMAINDER, help="Command to execute")

    # backup
    p_backup = subparsers.add_parser("backup", help="Backup the database")
    p_backup.add_argument("-o", "--output", type=str, default=None,
                          help="Output file path (default: backups/fittrack_YYYYMMDD_HHMMSS.sql.gz)")

    # restore
    p_restore = subparsers.add_parser("restore", help="Restore database from backup")
    p_restore.add_argument("backup_file", help="Path to backup file (.sql or .sql.gz)")
    p_restore.add_argument("-f", "--force", action="store_true", help="Skip confirmation prompt")

    return parser


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()

    # No subcommand â†’ interactive menu
    if args.command is None:
        _interactive_menu()
        return

    if args.command == "up":
        cmd_up(args.services or None, build=args.build)
        if args.migrate:
            cmd_migrate()
    elif args.command == "down":
        cmd_down(args.services or None)
    elif args.command == "restart":
        cmd_restart(args.services or None)
    elif args.command == "build":
        cmd_build(args.services or None)
    elif args.command in ("status", "ps"):
        cmd_status()
    elif args.command in ("monitor", "watch", "dash"):
        cmd_monitor(interval=args.interval)
    elif args.command in ("logs", "log"):
        cmd_logs(args.services or None, follow=not args.no_follow, tail=args.tail)
    elif args.command == "migrate":
        cmd_migrate()
    elif args.command == "reset":
        cmd_reset()
    elif args.command == "exec":
        cmd_exec(args.service, args.exec_command)
    elif args.command == "backup":
        cmd_backup(args.output)
    elif args.command == "restore":
        cmd_restore(args.backup_file, force=args.force)


if __name__ == "__main__":
    main()
