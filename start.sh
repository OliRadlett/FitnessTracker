#!/usr/bin/env bash
#
# FitTrack development startup script.
#
# Thin wrapper around fittrack.py — the FitTrack Service Manager.
# Delegates all work to the Python utility for cross-platform consistency.
#
# Usage:
#   ./start.sh                       Interactive menu
#   ./start.sh up                    Start all services
#   ./start.sh up backend frontend   Start specific services
#   ./start.sh status                Show service status
#   ./start.sh monitor               Live monitoring dashboard
#   ./start.sh logs backend          Tail backend logs
#   ./start.sh down                  Stop all services
#   ./start.sh restart frontend      Restart frontend
#   ./start.sh build                 Rebuild images
#   ./start.sh migrate               Run database migrations
#   ./start.sh reset                 Full teardown, rebuild, and restart with migrations

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FITTRACK="${SCRIPT_DIR}/fittrack.py"

# Find a suitable Python interpreter
PYTHON=""
for cmd in python3 python; do
    if command -v "$cmd" &> /dev/null; then
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
