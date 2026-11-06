# Relive 3D — P0 Runbook: standard key + never-spend cap

> **Status**: historical — superseded by the Google 3D viewer (#339); the key/cap runbook is retained for reference.

> Goal: a standard Google 3D key that **cannot spend money**. Expected usage is
> $0 within the 5,000 free Immersive Maps loads/month. The cap is the
> **`no spend` spend-cap budget** (0 GBP, project + Maps service) plus
> **key restrictions** plus an **app-side cap**.
>
> Do not put the production key in the repo. The key is a public browser key;
> restrict it by HTTP referrer and API.
>
> **A budget alert alone does not stop spend.** The spend cap does. The 3D Map
> loads metric has no consumer-quota limits endpoint, so no 100/day API quota
> is available.

---

## 0. Decisions to lock first

| Decision | Recommended |
|---|---|
| Google Cloud project | Existing `fitness-tracker-505713`; the spend cap is scoped to the Maps service. |
| Billing | Pay-as-you-go; no subscription plan. |
| Hard quota | **Not available**: `3d_billable_default` has no consumer-quota limits endpoint. |
| Spend cap | **`no spend`** budget, 0 GBP, project + Maps service, `spendCap: CONFIGURED`, 50/80/100. |
| App cap | **500 map opens/month** per user (Redis server-side) + fallback. |
| Key | One standard key; referrers cover production, dev and local. |

The key is in the main project, so a billing kill switch would break
Gemini/NextAuth. The spend cap is scoped to Maps and cannot affect the rest of
FitTrack. If the key moves to a dedicated project, add the kill switch there.

---

## 1. Create the dedicated project

> **Actual 2026-11-03:** the key lives in `fitness-tracker-505713` and the
> spend cap is scoped to the Maps service. Skip this section unless you are
> moving the key to a dedicated project to add the billing kill switch.

1. Google Cloud Console → **New Project**.
2. Name: `fittrack-relive-3d`; note the project ID.
3. Do **not** add other workloads to this project.

## 2. Enable billing

1. Console → **Billing** → link a billing account.
2. Confirm the account is in the right currency/region (EEA terms may apply).
3. The standard key requires billing; the 5,000 free Immersive Maps loads are
   applied to the billing account.

## 3. Enable the APIs

1. Console → **APIs & Services** → **Library**.
2. Enable **Maps JavaScript API**.
3. Enable the **3D Maps** product/SKU for the project (the console may show it
   as part of Maps JavaScript API / Immersive Maps).
4. Do **not** enable unrelated billable APIs. The raw **Map Tiles API** is not
   needed for the JS 3D map; enable it only if the console explicitly requires
   it for 3D.

## 4. Create the key and restrict it

1. Console → **APIs & Services** → **Credentials** → **Create credentials** →
   **API key**.
2. **Application restrictions** → **HTTP referrers**:
   - `https://oliradlett.co.uk/fittrack/*`
   - `https://dev.oliradlett.co.uk/fittrack/*`
   - `http://localhost:3000/*` (frontend dev)
   - `http://127.0.0.1:3000/*`
   - `http://localhost:3001/*` (frontend dev fallback port)
   - `http://127.0.0.1:3001/*`
   - `http://localhost:5199/*` (prototype dev)
   - `http://127.0.0.1:5199/*`
3. **API restrictions** → restrict to **Maps JavaScript API**
   (`maps-backend.googleapis.com`) and **Map Tiles API**
   (`tile.googleapis.com`) only.
4. Name it `MapsKey`.
5. Do not use this key for any other API or environment.

## 5. Hard quota — not available (documented)

The Service Usage consumer-quota metric
`maps-backend.googleapis.com/3d_billable_default` ("3D Map loads") exists, but
`.../limits` returns 404 for this project; no 100/day override can be created.
Do not spend time on the console quota for this metric. The spend cap is the
hard cap; if Google exposes a limit later, set 100/day.

## 6. Spend-cap budget (hard cap)

1. Console → **Billing** → **Budgets & alerts**: the **`no spend`** budget
   exists.
2. Scope: project `fitness-tracker-505713` + `services/29E7-DA93-CA13` (Maps);
   amount **0 GBP**; `spendCap: CONFIGURED`; thresholds 50/80/100%.
3. Key restrictions: `maps-backend.googleapis.com` + `tile.googleapis.com`;
   referrers production/dev/local.
4. No kill switch: the key is in the main project; detaching billing would
   break Gemini/NextAuth. The spend cap is scoped to Maps.

## 7. App-side cap

- The production app keeps a **server-side Redis counter** per user/month
  (e.g. 500 opens). Before mounting `Google3DWorld`, the app checks the counter
  and refuses the 3D map over the cap.
- The fallback is the static/2D route + story; the map is never a blank canvas.
- The client-side cap is a UX guard; a malicious client can bypass it, but the
  Google quota is the hard cap.

## 8. Test the cap (do this before production)

1. Open the viewer; the map loads.
2. Confirm the map renders and the key referrer works.
3. Check **Billing → Reports** for the Maps service; confirm free usage / £0.
4. Record the test date and screenshot in the plan.

## 9. Add the key

- Production frontend: `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (or a viewer-specific
  env), restricted as above.
- **It has to be a build arg, not a runtime env var.** Next inlines
  `NEXT_PUBLIC_*` into the client bundle, so a key (or the `RELIVE3D` flag)
  added to the Droplet's `.env` after the image is built changes nothing. The
  deploy workflow passes `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` from the
  `GOOGLE_MAPS_API_KEY` repo secret and `NEXT_PUBLIC_RELIVE3D` from the repo
  variable of the same name; `frontend/Dockerfile` declares both as `ARG`s
  before `npm run build`. Re-running Deploy is what picks a change up.
- Frontend dev page: `http://localhost:3000/fittrack/dev/relive3d` (use
  localhost, not 127.0.0.1, for the key's 3000/3001 referrers).
- Prototype: `prototype/relive/.env.local` (gitignored) for verification.
- Never commit the key or paste it into chat/logs.

## 10. Monitor and rollback

- Weekly: Billing → Reports → Maps usage vs the 5,000 free cap.
- Alert at 80% of the 5,000 free cap and at the spend-cap thresholds (50/80/100).
- If usage is unexpected, disable the key (Credentials → delete/disable) and
  fall back; investigate map-instance leaks.
- Rollback: disable the key or the `RELIVE3D` flag; the old viewer remains.

## 11. Acceptance for P0

- [x] Billing linked; Maps JavaScript API + 3D Maps enabled.
- [x] Standard key restricted by referrer and API.
- [x] Spend-cap budget `no spend` (0 GBP, project + Maps service) verified.
- [x] Map-load test passes; no charge.
- [ ] App-side cap implemented (P2).
- [x] Key in the correct env; not committed.
- [x] Usage monitoring in place.
- [ ] Terms/audience sign-off.

P1 (replay endpoint) and P2 (viewer shell) have started; the app cap and
production flag remain.
