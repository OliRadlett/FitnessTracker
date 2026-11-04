# Dashboard overhaul — lab

The prototype lab for the `/dashboard` rethink. It answers one question: **what should the
page be**, measured against the real record rather than argued about.

- What is wrong with the current page, with evidence: [`DIAGNOSIS.md`](DIAGNOSIS.md)
- What we agreed to build: [`CONTRACT.md`](CONTRACT.md)
- What "good" means here: [`REFERENCE.md`](REFERENCE.md)
- The gate result and the before/after table: [`GATE.md`](GATE.md)
- Every reversible choice, and the bake-off verdict: [`DECISIONS.md`](DECISIONS.md)

```
prototype/dashboard/
  fixtures/raw/        38 API payloads, captured from the production DB (read-only)
  qa/                  capture harness, before/after shots, contact sheets
    before/            the current /dashboard, captured from the running app
    out/               the artifact: 12 fixed frames + contact sheets
  src/
    lab/              fixture loader, derivations, charts, markdown renderer, primitives
    zones/            Today (both candidates), Trends, History
```

## Two candidates

`?variant=a` — **The Answer**: the decision first, its evidence beside it, no chart above the fold.
`?variant=b` — **The Console**: the instrument band first, the decision inside it.

Both use the same fixture, the same primitives and the same three zones (Today · Trends ·
History). The bake-off is on the Today zone, which is where the two philosophies differ.

## Three zones

- **Today** — act. The stance, its six engines, the day, the 14-day join, three recent rows.
- **Trends** — review. One range control; three charts; goals; the analyses (collapsed).
- **History** — the record. Year totals, a 12-month table, PRs.

## Reproduce

Everything is deterministic: the fixture pins the clock with `?now=`, the URL pins the zone
and the candidate, and every chart is animation-free so a screenshot cannot catch a
half-drawn series.

```powershell
cd prototype/dashboard
npm install
npm run dev            # http://127.0.0.1:5302/?variant=a&zone=today&now=2026-11-04
```

Capture the artifact and rebuild the sheets:

```powershell
cd prototype/dashboard
node qa/capture.mjs         # 12 frames -> qa/out/, plus overflow + console + nav-clearance checks
python qa/sheet.py          # -> qa/out/compare-today.png, contact-sheet-{desktop,mobile}.png
```

Typecheck and test:

```powershell
cd prototype/dashboard
npx tsc --noEmit
npm test                    # 9 tests: the markdown parser, mojibake repair, the stance reader
```

### Refreshing the fixture

The fixture is a snapshot, not a live feed. To take a new one (read-only — the capture
harness only issues GETs), from `frontend/` with the dev server running:

```powershell
$env:BACKEND_TOKEN = python ../fittrack.py exec backend python -c "import uuid;from app.services.auth import create_access_token;print(create_access_token(uuid.UUID('<user-id>')))"
$env:SESSION_COOKIE = node ../prototype/dashboard/qa/mint-session.mjs
node ../prototype/dashboard/qa/capture-before.mjs
```

That writes `fixtures/raw/*.json` and the `qa/before/` frames in one pass, so the before and
after sheets always come from the same data.

## Rules this lab follows

- **No auth, no backend.** The app is not running behind the lab; the fixture is a committed
  snapshot and every number traces to it.
- **Deletable in one commit.** Nothing in `frontend/` or `backend/` was modified.
- **Prototype code is not production code.** The production plan ports the decisions, not
  these files.
