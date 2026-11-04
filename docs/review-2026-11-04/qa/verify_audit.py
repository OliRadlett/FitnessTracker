#!/usr/bin/env python3
"""Verify the 2026-11-04 FitTrack audit against a checkout.

The audit is a snapshot. This script re-reads the evidence anchors in
``findings.json`` so the report cannot quietly rot:

* every ``contains`` token must still be present;
* every ``absent`` token must still be absent;
* a ``section`` restricts the same checks to a slice of the file;
* ``order`` checks that one token appears before another.

Exit codes
----------
0  artifact gate passes (every finding's evidence is present)
1  artifact gate fails (a finding is fixed, drifted, or a path is missing)
2  ``--strict``: at least one P0/P1 finding is still open (release gate fails)

The artifact gate is expected to pass at audit time. The release gate is
expected to FAIL at audit time: that is the point of the register. Fix an
item and the artifact gate reports it as FIXED/DRIFT, which is the signal to
update the report rather than trust a stale table.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


def _as_list(value: str | list[str] | None) -> list[str]:
    if value is None:
        return []
    return [value] if isinstance(value, str) else list(value)


def _check_contains(text: str, needle: str, label: str) -> list[str]:
    return [] if needle in text else [f"{label}: missing {needle!r}"]


def _check_absent(text: str, needle: str, label: str) -> list[str]:
    return [] if needle not in text else [f"{label}: still present {needle!r}"]


def _slice(text: str, spec: dict[str, Any], label: str) -> tuple[str, list[str]]:
    start_token = spec.get("start")
    end_token = spec.get("end")
    if not start_token or not end_token:
        return "", [f"{label}: section needs start and end"]
    try:
        start = text.index(start_token)
    except ValueError:
        return "", [f"{label}: section start missing {start_token!r}"]
    try:
        end = text.index(end_token, start + len(start_token))
    except ValueError:
        return "", [f"{label}: section end missing {end_token!r}"]
    return text[start:end], []


def evaluate_checks(repo: Path, finding: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    for index, check in enumerate(finding.get("checks", []), start=1):
        label = f"{finding['id']} check {index}"
        rel = check.get("path")
        if not rel:
            errors.append(f"{label}: no path")
            continue
        path = repo / rel
        if not path.exists():
            errors.append(f"{label}: missing file {rel}")
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")

        section = check.get("section")
        body = text
        if section:
            body, section_errors = _slice(text, section, label)
            errors.extend(section_errors)
            if section_errors:
                continue
            for needle in _as_list(section.get("contains")):
                errors.extend(_check_contains(body, needle, label))
            for needle in _as_list(section.get("absent")):
                errors.extend(_check_absent(body, needle, label))

        for needle in _as_list(check.get("contains")):
            if not section:
                errors.extend(_check_contains(text, needle, label))
        for needle in _as_list(check.get("absent")):
            if not section:
                errors.extend(_check_absent(text, needle, label))

        order = check.get("order")
        if order:
            if len(order) != 2:
                errors.append(f"{label}: order needs exactly two tokens")
            else:
                first, second = order
                a = text.find(first)
                b = text.find(second)
                if a < 0:
                    errors.append(f"{label}: order token missing {first!r}")
                elif b < 0:
                    errors.append(f"{label}: order token missing {second!r}")
                elif a > b:
                    errors.append(f"{label}: {first!r} must appear before {second!r}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repo",
        type=Path,
        default=Path(__file__).resolve().parents[3],
        help="checkout to verify (default: the repo containing this file)",
    )
    parser.add_argument(
        "--json", action="store_true", help="emit machine-readable JSON"
    )
    parser.add_argument(
        "--artifact",
        action="store_true",
        help="artifact gate: fail if any finding's evidence is missing (default)",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="release gate: fail if any P0/P1 finding is still open",
    )
    args = parser.parse_args()

    repo = args.repo.resolve()
    manifest = Path(__file__).resolve().parents[1] / "findings.json"
    data = json.loads(manifest.read_text(encoding="utf-8"))
    findings = data["findings"]

    results: list[dict[str, Any]] = []
    for finding in findings:
        errors = evaluate_checks(repo, finding)
        results.append(
            {
                "id": finding["id"],
                "severity": finding["severity"],
                "primary": bool(finding.get("primary")),
                "area": finding["area"],
                "title": finding["title"],
                "status": "OPEN" if not errors else "FIXED/DRIFT",
                "errors": errors,
            }
        )

    open_p0_p1 = [
        r for r in results if r["primary"] and r["severity"] in ("P0", "P1") and r["status"] == "OPEN"
    ]
    artifact_ok = all(r["status"] == "OPEN" for r in results)

    if args.json:
        print(
            json.dumps(
                {
                    "target": data["meta"]["target"],
                    "artifact_gate": "PASS" if artifact_ok else "FAIL",
                    "release_gate": "FAIL" if open_p0_p1 else "PASS",
                    "open_p0_p1": [r["id"] for r in open_p0_p1],
                    "results": results,
                },
                indent=2,
            )
        )
    else:
        print(f"target: {data['meta']['target']}")
        print(
            f"fixture: {data['meta']['fixture']['counts']} "
            f"({data['meta']['fixture']['properties']})"
        )
        print()
        print(f"{'ID':7} {'SEV':4} {'STATUS':10} AREA")
        print("-" * 78)
        for result in results:
            sev = result["severity"] + ("*" if result["primary"] else "")
            print(
                f"{result['id']:7} {sev:4} {result['status']:10} {result['area']}"
            )
            for error in result["errors"]:
                print(f"        - {error}")
        print()
        print(f"artifact gate: {'PASS' if artifact_ok else 'FAIL'}")
        print(
            "release gate: "
            + ("PASS" if not open_p0_p1 else f"FAIL ({len(open_p0_p1)} open P0/P1: {', '.join(r['id'] for r in open_p0_p1)})")
        )
        print("(* = primary finding)")

    if args.strict:
        return 1 if open_p0_p1 else 0
    return 0 if artifact_ok else 1


if __name__ == "__main__":
    sys.exit(main())
