"""Check that the agent project manifest points at real repository paths.

The manifest is intentionally YAML so humans can edit it. This checker uses a
small path-oriented parser instead of adding a YAML runtime dependency to the
application package.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / ".agent" / "project.yaml"
PATH_RE = re.compile(
    r"(?:backend|frontend|docs|scripts|plans|infra|\.agent|\.github)/[^\s,\]\[]+"
)


def manifest_paths() -> list[str]:
    paths: list[str] = []
    for line in MANIFEST.read_text(encoding="utf-8").splitlines():
        if line.lstrip().startswith("api_contract_ci:"):
            continue
        paths.extend(PATH_RE.findall(line))
    return sorted(set(path.rstrip("`") for path in paths))


def main() -> int:
    if not MANIFEST.exists():
        print(f"Missing {MANIFEST.relative_to(ROOT)}")
        return 1

    missing = [path for path in manifest_paths() if not (ROOT / path).exists()]
    if missing:
        print("Agent manifest references missing paths:")
        print("\n".join(f"- {path}" for path in missing))
        return 1

    required_maps = [
        "backend/app/api/CODEMAP.md",
        "backend/app/models/CODEMAP.md",
        "backend/app/services/CODEMAP.md",
        "frontend/src/CODEMAP.md",
    ]
    missing_maps = [path for path in required_maps if not (ROOT / path).exists()]
    if missing_maps:
        print("Missing required CODEMAP files:")
        print("\n".join(f"- {path}" for path in missing_maps))
        return 1

    print(f"Agent manifest valid: {len(manifest_paths())} repository paths checked")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
