# Review — 2026-10-15

Read-only audit of FitTrack at commit **`5f54f40`** (detached HEAD, clean tree).
One document per domain. Every finding carries a `path:line` evidence anchor, and each was
checked against the **code**, not against plan checkboxes — the plans proved stale in both
directions, so several documents below were corrected during consolidation (noted inline).

> **Snapshot note.** These documents describe `5f54f40`. Before execution `origin/main` had
> advanced to `4401812` (8 commits, migration head now `101`), so any claim naming a migration
> head reflects the snapshot. The programme plan re-checks head-dependent claims against
> `origin/main`; PR-01's test computes the head dynamically rather than hard-coding it.

| Document | Domain | Contents |
|----------|--------|----------|
| [`science-review.md`](science-review.md) | Sports-science / algorithms | Every physiological formula checked against the primary literature (citations included). What is faithful (TSS/NP, hrTSS, FRIEND, Morton, Brzycki, Coggan zones, VBT MVTs, Big-3) and **14 findings** — mis-calibrated VO2max bands (the scope caveat is defined but never surfaced), climb categories that don't implement Strava's score, decoupling that uses mean power instead of NP, TSB without the one-day lag, and three citation mis-attributions. |
| [`unused-features.md`](unused-features.md) | Dead code & half-wired features | Unimported frontend code (the whole `mode-shell/` package, `Reveal`, `sportIcons.ts`, the 15k-line `types/generated.ts`), ~20 declaration-only backend functions, the **inert orphan-route quarantine** (UI + endpoints built, producer never called), over-exported watch-holders, stale CODEMAPs, and a 15-item "verified NOT dead" list. |
| [`enhancements.md`](enhancements.md) | Features & enhancements | Plan ↔ code status reconciliation **with corrections** (training Phases 0–4 + S1/S2 and video Phase 5–6 are shipped, not "not started"), ~20 new feature proposals, enhancements to shipped features, deliberate non-goals, and a re-ranked Top 5. |
| [`bugs.md`](bugs.md) | Bugs | 7 confirmed defects (incl. an unvalidated-body 500, `merged_count` that is never incremented, a timezone-dated weigh-in, and a `cos(lat)` grid bug), a migration-chain all-clear, 6 doc/config inconsistencies, and an explicit **false-positive list** so the inflated first-pass "critical" claims are not chased. |

## Cross-cutting notes from consolidation

- **Alembic chain is clean**: head is **`099`**; `003` and `073` are absent but not dangling
  (`074.down_revision == "072"`; `004_add_pr_notes.py` carries `revision = "004"`), no duplicate
  ids. `docs/BUGS.md` **BUG-013 is already fixed**.
- **The `plans/*.md` files are the least reliable source in the repo.** Two status documents had
  to be corrected after verification: the training overhaul is largely *built* (contradicting
  `AGENTS.md` "Nothing built yet"), and the video-intelligence weekly task + charts +
  `VideoProgressTab` are *shipped* (contradicting the modal plan's "open" notes).
- **`docs/RUNNING.md` is stale and self-contradictory**: line 112 says head is `079` and names a
  phantom `014_add_composite_indexes.py`; line 58 says run pytest in the container while lines
  75–76 say the host; line 75 cites "pitfall #19" for the rule that is actually pitfall **#23**.
- **Prior cleanup was never landed**: `plans/weak-areas-remediation-2026-09-26.md:47` already
  lists dead code that is still dead (`score_route_breakdown`, …) — its open rows are
  re-confirmed, not new.

## Reading order

For a quick pass: this table → `bugs.md` §1 → `unused-features.md` §C (half-wired) →
`science-review.md` findings S1–S3 → `enhancements.md` §5.

Method and scope are stated in each document's header. Findings are static-analysis; anything
needing a live reproduction is labelled as such.
