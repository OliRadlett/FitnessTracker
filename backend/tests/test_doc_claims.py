"""Guards for doc claims that rot silently.

The migration head is the claim that decays fastest, because every new migration
invalidates it and nothing notices. These tests read the revision files on disk
and check `docs/RUNNING.md` against them, so a stale doc fails a test instead of
a reader.
"""

import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
VERSIONS = REPO / "backend" / "alembic" / "versions"
RUNNING = REPO / "docs" / "RUNNING.md"

# A revision assignment, tolerating an annotation such as `: str` or `: str | None`.
_REVISION = re.compile(r'^revision\s*(?::[^=\n]*)?=\s*"([^"]+)"', re.MULTILINE)
_DOWN_REVISION = re.compile(r"^down_revision\s*(?::[^=\n]*)?=\s*(.+)$", re.MULTILINE)
_DOCUMENTED_HEAD = re.compile(r"\bhead is `([^`]+)`")
_MENTIONED_MIGRATION = re.compile(r"\b(\d{3}_[A-Za-z0-9_]+\.py)\b")


def _revision_headers() -> tuple[set[str], set[str]]:
    revisions: set[str] = set()
    parents: set[str] = set()
    for path in VERSIONS.glob("*.py"):
        text = path.read_text(encoding="utf-8", errors="ignore")
        revision = _REVISION.search(text)
        if revision:
            revisions.add(revision.group(1))
        down = _DOWN_REVISION.search(text)
        if down:
            parents.update(re.findall(r'"([^"]+)"', down.group(1)))
    return revisions, parents


def _migration_head() -> str:
    revisions, parents = _revision_headers()
    heads = sorted(revisions - parents)
    assert len(heads) == 1, f"expected exactly one migration head, found {heads}"
    return heads[0]


def test_running_documents_the_real_migration_head():
    documented = _DOCUMENTED_HEAD.search(RUNNING.read_text(encoding="utf-8"))
    assert documented, "docs/RUNNING.md must state the head as `head is `<revision>``"
    assert documented.group(1) == _migration_head(), (
        "docs/RUNNING.md documents a stale migration head. "
        f"Documented {documented.group(1)}, real head is {_migration_head()}."
    )


def test_running_only_names_migration_files_that_exist():
    """A doc that names a migration file which does not exist is a stale claim.

    This is the general form of the `014_add_composite_indexes.py` mistake, so
    fixing that one name does not leave the class of mistake unguarded.
    """
    present = {path.name for path in VERSIONS.glob("*.py")}
    mentioned = set(_MENTIONED_MIGRATION.findall(RUNNING.read_text(encoding="utf-8")))
    missing = sorted(mentioned - present)
    assert not missing, f"docs/RUNNING.md names migration files that do not exist: {missing}"
