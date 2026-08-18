#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# FitTrack development startup script (Bash / POSIX shell).
# Thin wrapper around fittrack.py — the FitTrack Service Manager.
# Delegates all work to the Python utility for cross-platform consistency.
#
# Usage:
#     ./start.sh                       # Interactive menu
#     ./start.sh up                    # Start all services
#     ./start.sh up backend frontend   # Start specific services
#     ./start.sh status                # Show service status
#     ./start.sh monitor               # Live monitoring dashboard
#     ./start.sh logs backend          # Tail backend logs
#     ./start.sh down                  # Stop all services
#     ./start.sh restart frontend      # Restart frontend
#     ./start.sh build                 # Rebuild images
#     ./start.sh migrate               # Run database migrations
#     ./start.sh reset                 # Full teardown, rebuild, restart with migrations
#     ./start.sh backup                # Backup database to backups/
#     ./start.sh backup -o my.sql.gz   # Backup to custom path
#     ./start.sh restore backups/fittrack_20260101_120000.sql.gz  # Restore from backup
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FITTRACK="${SCRIPT_DIR}/fittrack.py"

# Prefer python3, fall back to python
PYTHON=""
for cmd in python3 python; do
    if command -v "$cmd" &>/dev/null; then
        PYTHON="$cmd"
        break
    fi
done

if [ -z "$PYTHON" ]; then
    echo -e "\033[31mERROR: Python 3 is required but was not found on PATH.\033[0m"
    echo -e "\033[31mInstall Python 3.10+ and try again.\033[0m"
    exit 1
fi

exec "$PYTHON" "$FITTRACK" "$@"
