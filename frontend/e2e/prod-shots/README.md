# PROD screenshot pipeline (read-only)

Automated Playwright harness that screenshots the **real prod deployment**
(`https://oliradlett.co.uk/fittrack`) for the UI deep-dive. Mocked E2E
(`playwright.config.ts`) stays untouched — this pipeline is a separate
config with **no mocks, no webServer, no local stack**.

## First time (once per ~7 days / whenever prod bounces to login)

```bash
cd frontend
npm run test:prod-shots:auth     # opens a HEADED browser
```

1. Sign in with Google (or GitHub) in that window, pass the allowlist.
2. The script waits for `/fittrack/dashboard|today|calendar|activities`,
   then saves `e2e/prod-shots/.auth/storageState.json` (gitignored).
3. Close the browser. Headless runs reuse that state from now on.

## Capture (headless, read-only)

```bash
cd frontend
npm run test:prod-shots                              # all routes, desktop + mobile
SHOT_FILTER=08-lifting npm run test:prod-shots       # one route only
VIEWPORT=desktop npm run test:prod-shots             # (via --project) one viewport
```

Output: `screenshots/prod/desktop/*.png` + `screenshots/prod/mobile/*.png`
(gitignored). Tab states append `--tab-<name>.png`.

## Safety contract (do not weaken)

- **Only GETs/navigations.** `prod-shots.spec.ts` aborts every
  POST/PATCH/PUT/DELETE to `/api/**` via `route.abort('blockedbyclient')`
  and logs the block. Console warnings starting `[read-only guard]` mean
  the guard fired — investigate, don't remove it.
- **No mutation clicks.** Tab switches are client-side state only. Never
  click Generate / Save / Merge / Sync / Connect / Start workout /
  Recalculate / Backfill / Upload. Route notes in `routes.manifest.ts`
  repeat the per-page forbidden actions.
- **Never point a local frontend at the prod API** (`NEXT_PUBLIC_API_URL`
  stays `''`) and **never copy the prod DB locally**. This harness drives
  the prod frontend in the cloud; nothing runs locally except Playwright.
- Sequential (`workers: 1`, `retries: 0`) to keep prod load negligible.

## Coverage

`routes.manifest.ts` is the source of truth: 17 sidebar routes + hidden
`/routes/duplicates` + public `/` = 19 captures, in sidebar order, each
with desktop 1440×900 + mobile 390×844. Deep-link variants (`?activity=`,
`?session=`, `?route=`, `?replay=`) are captured only with
runtime-discovered ids (first card on the page) — never hardcoded, because
prod ids are real user data. `/dev/replay` is dev-only and excluded.

## Troubleshooting

| Symptom | Cause → fix |
|---|---|
| `Not authenticated on prod … re-run auth` | `storageState.json` expired (7-day JWT) → rerun `test:prod-shots:auth` |
| Blank `main` / no `h1` | Prod deploy in flight or OAuth outage — wait, rerun with `SHOT_FILTER` |
| Map tiles half-loaded | Real OSM tiles on prod (kept intentionally); rerun single route |
| `[read-only guard] blocked …` | A component attempted a write — do NOT click through it; report to captain |
