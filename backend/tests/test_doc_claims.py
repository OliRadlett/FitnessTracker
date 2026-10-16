"""Guards for doc claims that rot silently.

The migration head is the claim that decays fastest, because every new migration
invalidates it and nothing notices. This test computes the head from the revision
files on disk and compares it to the number `docs/RUNNING.md` states, so a stale
doc fails a test instead of a reader.
"""

import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
VERSIONS = REPO / "backend" / "alembic" / "versions"
RUNNING = REPO / "docs" / "RUNNING.md"


def _revision_headers() -> tuple[set[str], set[str]]:
    revisions: set[str] = set()
    parents: set[str] = set()
    for path in VERSIONS.glob("*.py"):
        text = path.read_text(encoding="utf-8", errors="ignore")
        revision = re.search(r'^revision(?::\s*str)?\s*=\s*"([^"]+)"', text, re.MULTILINE)
        if revision:
            revisions.add(revision.group(1))
        down = re.search(r"^down_revision(?::[^=]+)?\s*=\s*(.+)$", text, re.MULTILINE)
        if down:
            parents.update(re.findall(r'"([^"]+)"', down.group(1)))
    return revisions, parents


def _migration_head() -> str:
    revisions, parents = _revision_headers()
    heads = sorted(revisions - parents)
    assert len(heads) == 1, f"expected exactly one migration head, found {heads}"
    return heads[0]


def test_running_documents_the_real_migration_head():
    documented = re.search(r"Current head is `([^`]+)`", RUNNING.read_text(encoding="utf-8"))
    assert documented, "docs/RUNNING.md must state the head as `Current head is `<rev>``"
    assert documented.group(1) == _migration_head(), (
        "docs/RUNNING.md documents a stale migration head. "
        f"Documented {documented.group(1)}, real head is {_migration_head()}."
    )


def test_running_does_not_name_the_phantom_migration():
    assert "014_add_composite_indexes.py" not in RUNNING.read_text(encoding="utf-8"), (
        "docs/RUNNING.md still names a stale duplicate migration file that never existed"
    )
