"""Repair mojibake introduced by a Set-Content round-trip in the lab sources.

Reads each file as UTF-8, maps the cp1252-misdecoded sequences back to their
characters, and writes it back as UTF-8 (no BOM). Idempotent: a clean file is
written unchanged.

Run: python qa/repair_encoding.py
"""

from __future__ import annotations

import sys
from pathlib import Path

REPAIRS = {
    "\u00e2\u20ac\u201d": "\u2014",  # â€” -> em dash
    "\u00e2\u20ac\u201c": "\u2013",  # â€“ -> en dash
    "\u00e2\u20ac\u2122": "\u2019",  # â€™ -> right single quote
    "\u00e2\u20ac\u0153": "\u201c",  # â€œ -> left double quote
    "\u00e2\u02c6\u2019": "\u2212",  # âˆ’ -> minus sign
    "\u00e2\u2013\u00be": "\u25be",  # â–¾ -> chevron
    "\u00e2\u201d\u20ac": "\u2500",  # â”€ -> box drawing light horizontal
    "\u00e2\u2020\u2019": "\u2192",  # â†’ -> right arrow
    "\u00e2\u0152\u02dc": "\u2318",  # âŒ˜ -> command
    "\u00e2\u20ac": "\u201d",  #        â€  -> right double quote
    "\u00c3\u2014": "\u00d7",  #        Ã—  -> multiplication sign
    "\u00c2\u00b7": "\u00b7",  #        Â·  -> middle dot
    "\u00c2": "",  #                    stray Â
}

SRC = Path(__file__).resolve().parent.parent / "src"


def main() -> int:
    changed = 0
    for path in sorted(SRC.rglob("*")):
        if path.suffix not in {".ts", ".tsx", ".css", ".json"}:
            continue
        text = path.read_text(encoding="utf-8")
        fixed = text
        for bad, good in REPAIRS.items():
            fixed = fixed.replace(bad, good)
        if fixed != text:
            path.write_text(fixed, encoding="utf-8", newline="\n")
            changed += 1
            print(f"repaired {path.relative_to(SRC.parent)}")
    print(f"{changed} file(s) repaired")
    return 0


if __name__ == "__main__":
    sys.exit(main())
