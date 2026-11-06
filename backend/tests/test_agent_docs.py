"""Guards for the DSH steering files.

`AGENTS.md` is injected into every DSH session, so its size is a real cost and
its references are real instructions. These tests keep the file lean, keep it
free of OpenCode-only syntax, and keep the detail docs honest:

- the 24 KB budget on AGENTS.md;
- no `@backend`-style agent invocations (DSH has no callable named agents);
- relative links in every steering doc resolve;
- every project skill has valid frontmatter and an OpenCode counterpart;
- the pitfall index in AGENTS.md matches docs/PITFALLS.md one-for-one.

No database, no network: safe to run with `pytest backend/tests/test_agent_docs.py`.
"""

import ast
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
AGENTS = REPO / "AGENTS.md"
PITFALLS = REPO / "docs" / "PITFALLS.md"

# The always-injected file, plus the docs it routes to. Every relative link in
# these must resolve; a broken link here is a broken instruction.
STEERING_DOCS = [
    AGENTS,
    REPO / "docs" / "README.md",
    REPO / "docs" / "DECISIONS.md",
    REPO / "docs" / "DSH.md",
    REPO / "docs" / "RUNNING.md",
    REPO / "docs" / "PITFALLS.md",
    REPO / "docs" / "ANDROID.md",
    REPO / "plans" / "README.md",
    REPO / ".dsh" / "README.md",
]

# OpenCode agent names that DSH cannot invoke. AGENTS.md may *mention* the old
# personas, but must not present them as callable.
_OPENCODE_AGENT = re.compile(
    r"@(backend|frontend|debugger|sync-engineer|production|ask)\b"
)

_LINK = re.compile(r"\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
_SKILL_FRONTMATTER = re.compile(r"\A---\r?\n(.*?)\r?\n---\r?\n", re.DOTALL)
_PITFALL_INDEX = re.compile(r"^(\d+)\. ", re.MULTILINE)
_PITFALL_ENTRY = re.compile(r"^(\d+)\. \*\*", re.MULTILINE)


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_agents_md_stays_within_context_budget():
    """AGENTS.md is injected into every session; detail belongs in docs."""
    size = AGENTS.stat().st_size
    assert size <= 24_000, (
        f"AGENTS.md is {size} bytes, over the 24 KB budget. Move detail into a "
        "linked doc and keep a one-line pointer here."
    )


def test_agents_md_has_no_opencode_agent_invocations():
    text = _read(AGENTS)
    found = sorted(set(_OPENCODE_AGENT.findall(text)))
    assert not found, (
        "AGENTS.md presents OpenCode agents as callable: "
        f"{found}. DSH delegates with the `subagent` tool; see docs/DSH.md."
    )


def test_agents_md_does_not_advertise_opencode_tui():
    text = _read(AGENTS)
    assert "OpenCode TUI Tips" not in text
    assert "`@filename`" not in text


def test_steering_docs_relative_links_resolve():
    broken: list[str] = []
    for doc in STEERING_DOCS:
        assert doc.exists(), f"steering doc is missing: {doc.relative_to(REPO)}"
        for target in _LINK.findall(_read(doc)):
            if target.startswith(("#", "http://", "https://", "mailto:")):
                continue
            # A line-suffixed code reference (`file.py:12`) is not a link target.
            if ":" in target.split("/")[0]:
                continue
            path = target.split("#", 1)[0].split("?", 1)[0]
            if not path:
                continue
            resolved = (doc.parent / path).resolve()
            if not resolved.exists():
                broken.append(f"{doc.relative_to(REPO)} -> {target}")
    assert not broken, "broken relative links in steering docs:\n" + "\n".join(broken)


def test_every_project_skill_has_valid_frontmatter():
    skills = sorted((REPO / ".dsh" / "skills").glob("*/SKILL.md"))
    assert skills, "no project skills found under .dsh/skills/"
    for path in skills:
        text = _read(path)
        match = _SKILL_FRONTMATTER.match(text)
        assert match, f"{path}: SKILL.md must start with a --- frontmatter block"
        fields: dict[str, str] = {}
        for line in match.group(1).splitlines():
            if ":" in line:
                key, value = line.split(":", 1)
                fields[key.strip()] = value.strip().strip('"').strip("'")
        name = fields.get("name", "")
        assert name == path.parent.name, (
            f"{path}: frontmatter name {name!r} must match directory "
            f"{path.parent.name!r}"
        )
        description = fields.get("description", "")
        assert len(description) >= 20, (
            f"{path}: description must be a trigger-oriented sentence, got "
            f"{description!r}"
        )


def test_every_dsh_skill_has_an_opencode_counterpart():
    """The two skill trees are copies; coverage must not silently diverge.

    `feature-quality` is DSH-only (it ships with the project plugin), so it is
    the one allowed exception.
    """
    dsh = {p.parent.name for p in (REPO / ".dsh" / "skills").glob("*/SKILL.md")}
    opencode = {
        p.parent.name for p in (REPO / ".opencode" / "skills").glob("*/SKILL.md")
    }
    assert dsh - {"feature-quality"} <= opencode, (
        "DSH skills without an OpenCode copy: "
        f"{sorted(dsh - {'feature-quality'} - opencode)}"
    )
    assert opencode <= dsh, f"OpenCode skills missing from DSH: {sorted(opencode - dsh)}"


def test_pitfall_index_matches_the_canonical_list():
    """AGENTS.md carries the index; docs/PITFALLS.md carries the detail."""
    agents = _read(AGENTS)
    start = agents.index("## Critical Pitfalls")
    end = agents.index("## Development Lessons")
    index = [int(n) for n in _PITFALL_INDEX.findall(agents[start:end])]
    entries = [int(n) for n in _PITFALL_ENTRY.findall(_read(PITFALLS))]
    assert index == entries, (
        "AGENTS.md pitfall index and docs/PITFALLS.md disagree. "
        f"Index: {index}; entries: {entries}. Append, never renumber."
    )


def test_documented_table_count_matches_the_models():
    """A count in the injected file must not rot when a model is added."""
    text = _read(AGENTS)
    match = re.search(r"\*\*(\d+) tables, UUID PKs\*\*", text)
    assert match, "AGENTS.md must state the table count as '**N tables, UUID PKs**'"
    names: set[str] = set()
    for path in (REPO / "backend" / "app" / "models").glob("*.py"):
        names.update(re.findall(r'__tablename__\s*=\s*"([^"]+)"', _read(path)))
    assert int(match.group(1)) == len(names), (
        f"AGENTS.md says {match.group(1)} tables; the models define {len(names)}. "
        "Update the count (or remove the claim and point at the models CODEMAP)."
    )


def test_algorithms_chart_claim_matches_the_registry():
    """The chart count/list in docs/algorithms.md is a claim about code.

    It rotted once (43 documented, 46 registered, five names that did not
    exist). Pin both the count and the set.
    """
    tree = ast.parse(_read(REPO / "backend" / "app" / "api" / "charts.py"))
    keys: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for target in targets:
                if (
                    isinstance(target, ast.Name)
                    and target.id == "CHART_REGISTRY"
                    and isinstance(node.value, ast.Dict)
                ):
                    keys = [
                        k.value for k in node.value.keys if isinstance(k, ast.Constant)
                    ]
    assert keys, "CHART_REGISTRY not found in api/charts.py"
    doc = _read(REPO / "docs" / "algorithms.md")
    match = re.search(r"(\d+) charts registered: ([^.]+)\.", doc)
    assert match, "docs/algorithms.md must state 'N charts registered: ...'"
    documented = [name.strip() for name in match.group(2).split(",")]
    assert int(match.group(1)) == len(keys), (
        f"docs/algorithms.md says {match.group(1)} charts; the registry has {len(keys)}"
    )
    assert set(documented) == set(keys), (
        "docs/algorithms.md chart list disagrees with CHART_REGISTRY: "
        f"missing {sorted(set(keys) - set(documented))}, "
        f"extra {sorted(set(documented) - set(keys))}"
    )


def test_route_embedding_dimension_claim_matches_the_code():
    src = _read(REPO / "backend" / "app" / "services" / "route_embedding.py")

    def const(name: str) -> int:
        found = re.search(rf"^{name} = (\d+)", src, re.MULTILINE)
        assert found, f"{name} not found in route_embedding.py"
        return int(found.group(1))

    terrain = re.search(r"_TERRAIN = \(([^)]*)\)", src)
    assert terrain, "_TERRAIN not found"
    terrain_n = len([x for x in terrain.group(1).split(",") if x.strip()])
    scalars = re.search(r"_T_OFF = _S_OFF \+ (\d+)", src)
    assert scalars, "_T_OFF layout not found"
    dim = (
        const("HEADING_BINS")
        + const("EDGE_BUCKETS")
        + const("NAME_BUCKETS")
        + int(scalars.group(1))
        + terrain_n
    )
    assert f"{dim}-dim vector" in _read(REPO / "docs" / "algorithms.md"), (
        f"route embedding is {dim}-dim; docs/algorithms.md does not say so"
    )


def test_bug_tracker_counts_match_the_files():
    bugs = _read(REPO / "docs" / "BUGS.md")
    archive = _read(REPO / "docs" / "BUGS-archive.md")
    open_count = len(re.findall(r"^### BUG-", bugs, re.MULTILINE))
    archived_count = len(re.findall(r"^\| BUG-", archive, re.MULTILINE))
    open_doc = re.search(r"Open: (\d+)", bugs)
    archived_doc = re.search(r"Archived: (\d+)", bugs)
    archived_header = re.search(r"(\d+) archived bugs", archive)
    assert open_doc and int(open_doc.group(1)) == open_count, (
        f"docs/BUGS.md says Open: {open_doc.group(1) if open_doc else '?'}; "
        f"it lists {open_count}"
    )
    assert archived_doc and int(archived_doc.group(1)) == archived_count, (
        f"docs/BUGS.md says Archived: {archived_doc.group(1) if archived_doc else '?'}; "
        f"the archive has {archived_count} rows"
    )
    assert archived_header and int(archived_header.group(1)) == archived_count, (
        "docs/BUGS-archive.md header count disagrees with its rows"
    )


def test_docs_index_lists_every_doc():
    """The docs map must not silently omit a doc.

    Adding a doc without a row means readers cannot tell whether it is current,
    reference, historical or legacy.
    """
    index = _read(REPO / "docs" / "README.md")
    docs = {
        p.name for p in (REPO / "docs").glob("*.md") if p.name != "README.md"
    }
    missing = sorted(name for name in docs if name not in index)
    assert not missing, (
        "docs/README.md does not list: "
        f"{missing}. Add a row with a status and a one-line purpose."
    )


def test_decisions_index_has_entries():
    decisions = _read(REPO / "docs" / "DECISIONS.md")
    assert "| D1 |" in decisions and "| D14 |" in decisions
    assert "Superseded" in decisions, "the index must say how decisions are retired"


def test_dsh_guide_exists_and_points_at_the_assets():
    text = _read(REPO / "docs" / "DSH.md")
    assert ".dsh/skills" in text
    assert ".dsh/plugins" in text
    assert "subagent" in text
