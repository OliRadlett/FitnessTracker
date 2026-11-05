# Integration opportunity review — 2026-11-05

> **Status 2026-11-05:** #1, #2 and the storage half of #8 are implemented on
> `feature/power-provenance-withings-payload` (migrations `107`, `108`, `109`). Two claims in the
> first draft did not survive contact with the code and are corrected inline: #1's proposed
> *exclusion* was aimed at a consumer that never sees an estimate (all stream-gated), and
> #6's Wahoo zone push already shipped as migration `103` before this review ran.

> Analysis only. No code changed by the review itself (follow-ups are separate commits).
> Question asked: *what do the third-party APIs expose that we don't take advantage of,
> and what new features does that make possible?*
> Answer in one line: the gaps are almost all **inside the providers already connected** —
> Strava, Whoop, Wahoo, Withings and Komoot each expose something we never call, three of
> them hand us fields we store and never read, and Withings asks for less than the scale can
> send — so the cheapest wins come from data already in `raw_data`, not from new APIs.

---

## 1. What is connected, and what we actually pull

| Provider | Auth | Scopes granted (`services/auth.py:58-113`) | Endpoints we call | Stored |
|---|---|---|---|---|
| **Strava** | OAuth2 | `read`, `activity:read_all` | `/athlete/activities`, `/activities/{id}` (webhook path only), `/activities/{id}/streams`, `/athlete`, `/athletes/{id}/routes`, `/routes/{id}`, webhook `activity` create/update/delete | 12 columns + full summary payload in `Activity.raw_data` (`strava/sync.py:109-129`); 7 stream types on cycling only (`strava_client.py:131-139`) |
| **Whoop** | OAuth2 | `offline`, `read:recovery`, `read:cycles`, `read:sleep`, `read:workout`, `read:profile`, `read:body_measurement` | `/v2/cycle` (paginated), `/v2/cycle/{id}/recovery` (**one call per cycle**), `/v2/activity/sleep`, `/v2/activity/workout`, `/v2/user/profile/basic`, `/v2/user/measurement/body` | `DailyMetric` (recovery, HRV, RHR, RR, strain, kcal), `SleepLog` (stages, efficiency), lifting enrichment (`services/whoop.py:993-998`) |
| **Wahoo** | OAuth2 | all 12, incl. `power_zones_read/write`, `user_write`, `plans_*`, `routes_*` | `/v1/user`, `/v1/routes` R/W, `/v1/plans` R/W, `/v1/workouts` W (scheduled) | Route push ids, plan/workout ids, activity enrichment (Strava is source of truth) |
| **Withings** *(scales only — no cuff, watch, mat or thermometer)* | OAuth2 | `user.info`, `user.metrics` | `getmeas` with `meastypes=1,5,6,8,76,77,88,170` (`withings_client.py:43`), `getbyuserid` | `WeightLog` body composition only — **no `raw_data`, so unmapped types are discarded** |
| **Komoot** | Basic (email/password) | n/a — reverse-engineered v007 | `/users/{id}/tours/`, `/tours/{id}/`, `/tours/{id}/coordinates/`, `/tours/{id}/surface` (singular — likely 404s, see §3.5) | Route geometry, elevation, surface profile; whole tour in `Route.raw_data` |
| **Open-Meteo** | none | — | `/v1/forecast`, `/v1/archive`, `/v1/elevation` (frontend only) | 8 weather columns on `Activity`, `CachedWeather` |
| **Google** | API key | Maps Platform (4 services), Gemini | Maps JS `libraries=maps3d`, `generativelanguage` | Relive 3D world; analyses |
| **Modal / TypeSafe / R2** | tokens | — | containers, Jev calls, S3 | compute results, tags, videos |

Not connected, deliberately (see `plans/training-aid-review.md:169`): Garmin, Oura, Apple
Health, TrainingPeaks, force plates. Nothing below requires adding one.

---

## 2. The biggest single finding: fields we already receive and never read

`Activity.raw_data` and `ActivitySource.raw_data` store the **whole** provider payload, so
these are already in Postgres. `grep` finds no reader for any of them:

| Field | Provider | What it answers | Cost to use |
|---|---|---|---|
| `device_watts` | Strava | is `average_watts` measured or **estimated** from HR? | zero — already stored |
| `gear_id` | Strava | which bike / which shoes | zero, plus one `GET /gear/{id}` for total distance |
| `elapsed_time` vs `moving_time` | Strava | stopped-time ratio (coffee stops, traffic) | zero |
| `elev_high` / `elev_low` | Strava | altitude range | zero |
| `trainer`, `commute`, `manual`, `flagged` | Strava | indoor vs outdoor, utility rides | zero |
| `pr_count`, `achievement_count` | Strava | Strava-side segment PRs on this ride | zero |
| `start_latlng` / `end_latlng` | Strava | geometry without a Route link | zero |
| `zone_durations` (z0–z5) | Whoop workout | HR zone time for sessions with no HR stream | zero — already in `raw_data` |
| `distance_meter`, `altitude_gain_meter`, `percent_recorded` | Whoop workout | completeness of a Whoop-recorded session | zero |
| `difficulty{grade, explanation_technical, explanation_fitness}`, `way_types[]`, `elevation_down`, `kcal_active` | Komoot tour | the provider's own route difficulty and road-character split | zero — already in `raw_data` |

`device_watts` is the sharpest of these. `Activity.tss_source` already distinguishes
`power` / `hr` / `provider` / `manual`, so provenance is a first-class concept everywhere
**except** the watts themselves — a ride recorded without a power meter gets
Strava-estimated `average_watts`, which flows into the power curve, CP/W′ and Pmax fits,
cycling PRs, W/kg, and TSS, all badged as if measured. Nothing in the pipeline can tell.

The general shape — **a provider field we store but never read** — is invisible to type
checking and to tests that build rows directly (this is the mirror of pitfall 37: a column
read but never written). It is worth making it structural; see §5.4.

---

## 3. Provider by provider: what is exposed and unused

### 3.1 Strava

Used: list, detail (webhooks only), 7 stream types, athlete, routes.

**Exposed, unused, and worth using**

- **`GET /activities/{id}/laps`** — `Lap[]` with `start_index` / `end_index` slicing
  directly into the streams. There is currently **no lap concept anywhere**: the only
  intra-ride structure is `pacing_analysis`, which cuts the ride into ten equal-time slices
  (`services/session_analysis.py:366-405`), so a 4×8 min session reads as ten arbitrary
  chunks and `power_variability` measures the slicing, not the session. One call per ride,
  or free inside detail.
- **Gear** — `gear_id` on every activity, `GET /gear/{id}` → `distance` (total metres),
  `brand_name`, `model_name`, `frame_type`, `primary`. `PUT /activities/{id}` can reassign
  or clear it (`"none"`). No retire endpoint — wear is our arithmetic on `distance`.
- **Streams we don't request**: `latlng`, `temp`, `grade_smooth`, `moving`. Same request,
  same call count, more bytes — `keys` is comma-separated.
  - `latlng` removes the polyline-interpolation fallback in `services/replay.py:361-365`.
  - `temp` makes on-bike temperature real; today it exists only for FIT imports
    (`services/fit_parser.py:227`), so the same ride has different data depending on how
    it arrived.
  - `grade_smooth` is Strava's own gradient, better than our altitude differencing at
    climb window edges.
- **`GET /athlete/zones`** (`profile:read_all`) — the athlete's *configured* HR/power
  zone boundaries. We compute zones from FTP/LTHR; reading Strava's would tell us when the
  user changed their device zones (a strong FTP-change hint that doesn't need a ride).
- **Activity writes** (`activity:write`, not requested): `POST /uploads` accepts
  `fit|fit.gz|tcx|tcx.gz|gpx|gpx.gz|json`, so a manual/FIT-imported session or a lifting
  session could reach Strava. `PUT /activities/{id}` edits name/description/sport_type/gear.
  `PUT /athlete` sets body weight (`profile:write`).
- **Webhook `object_type=athlete`** — deauthorization arrives as
  `{"object_type":"athlete","aspect_type":"update","updates":{"authorized":"false"}}`.
  `services/strava/webhooks.py:36` returns early unless `object_type == "activity"`, so a
  revoked grant is only discovered when a sync 401s.
- **`POST /oauth/revoke`** — we never revoke on disconnect (§4 #14).

**Exposed but not worth it**: segment leaderboards are not in the API at all; segment
efforts say "Requires subscription"; Segment Explore is Extended-Access-Tier only since
2026-09-01; clubs' activity/member endpoints were removed the same day; running races have
returned empty since 2021; `suffer_score` is null for non-subscribers; comments/kudos feed
a social graph this app doesn't have. Athlete stats duplicate our own aggregates.

**Constraint to design around**: the read bucket is **100 req / 15 min and 1,000 / day**
in single-player mode. Adding stream *keys* costs nothing; adding a per-ride `laps` call
costs 1 of 1,000. A full-history stream backfill is a multi-day drip, so anything that
needs a new per-ride call should ride along with a fetch we already make.

### 3.2 Whoop

Used: cycles, per-cycle recovery, sleep list, workouts (enrichment only).

**Exposed, unused**

- **`GET /v2/recovery` (collection)** — we call `/v2/cycle/{id}/recovery` **once per cycle**
  with a deliberate sleep between calls (`services/whoop.py:441-457`). The collection
  endpoint returns the same objects, paginated, in one request — and it carries the two
  fields we never read: **`spo2_percentage`** and **`skin_temp_celsius`**, plus
  `user_calibrating`. This is the single clearest win in the Whoop surface: fewer calls,
  more signal.
- **`score.sleep_needed`** — `baseline_milli`, `need_from_sleep_debt_milli`,
  `need_from_recent_strain_milli`, `need_from_recent_nap_milli`. We hand-roll sleep debt
  (`compute_sleep_debt`, `whoop.py:1142`) while Whoop publishes its own decomposition. The
  components also make a better *explanation* ("you're short 42 min because of Tuesday's
  strain") than a single number.
- **`sleep_performance_percentage`, `sleep_consistency_percentage`,
  `disturbance_count`, `total_no_data_time_milli`** — we compute a consistency chart
  ourselves (`sleep_consistency`) and ignore Whoop's own consistency figure and disturbance
  count. `total_no_data_time_milli` is the honest answer to "was the strap even on".
- **Workout `zone_durations`** (z0–z5) — HR zone time for a session. Lifting has no HR
  stream at all, so today there is no zone distribution for strength work.
- **Webhooks** — 6 event types (`workout|sleep|recovery` `.updated` / `.deleted`),
  `X-WHOOP-Signature` = base64 HMAC-SHA256 of `timestamp + raw body` keyed on the client
  secret, dedupe on `trace_id`, 5 retries over ~1 h. `.deleted` in particular is something
  polling handles badly: a deleted workout lingers until a reconcile.
- **`DELETE /v2/user/access`** — revoke on disconnect.

**Not available at all** (don't design around it): journal (alcohol/caffeine/stress),
per-second HR or streams, any write, cycle/body webhooks, trends.

### 3.3 Wahoo

Used: routes (read/write), plans (read/write), scheduled workouts (write), user (read).

**Exposed, unused — and the scopes are already granted**

- **`/v1/power_zones` (GET, POST, PUT, DELETE)** with `ftp`, `critical_power`, `zone_1..7`,
  `zone_count`, per sport via `workout_type_id`. We request `power_zones_read` **and**
  `power_zones_write` and never call either. After `auto_estimate_ftp_weekly` fixes an FTP,
  the head unit keeps showing zones from the old one until the user retypes them. We also
  compute CP/W′ — `critical_power` is a field Wahoo will store.
- **`PUT /v1/user`** — write `weight`, `height`. `user_write` is granted and unused; Wahoo's
  calorie and W/kg figures run on whatever weight was last typed into the app.
- **`GET /v1/workouts/{id}/workout_summary`** — `file.url` is an **activity FIT** with full
  record data, downloadable from their CDN and explicitly **not** counted against the API
  rate limit. For a Wahoo-recorded ride this is the only route to L/R balance, power phase
  and temperature, none of which Strava exposes.
- **Webhook `workout_summary`** — one event, shared `webhook_token` (no HMAC), retries at
  30 min / 4 h / 24 h / 72 h, duplicates possible. Would make ride ingestion near-instant
  instead of riding on the 30-minute Strava task.
- **`DELETE /v1/permissions`** — deauthorize on disconnect.

`workouts_write` for *completed* files (`POST /v1/workout_file_uploads`) is not useful to
us; there is no HR-zone endpoint despite the portal prose, and no live/streaming API.

### 3.4 Withings

**Connected hardware: smart scales only.** No BPM cuff, no ScanWatch, no Thermo, no U-Scan,
no Sleep mat. That splits the unused surface in two, and the split matters more than the
list.

> **Revised 2026-11-05.** The first pass of this review ranked blood pressure and AFib as a
> medium-value opportunity. With scale-only hardware they are worth zero. Everything below
> reflects the actual device.

Used: body composition only, 8 of the ~40 measurement types.

Withings publishes exactly **four** scopes — `user.info`, `user.metrics`, `user.activity`,
`user.sleepevents`. We hold the first two. There is no sleep/heart/workout scope; sleep
reads are gated by `user.activity`.

**Hardware-gated — do not build for these** (they will never return a value on a scale, and
a UI that offers them is a lie): blood pressure 9/10 (BPM cuff), ECG waveform and
QRS/PR/QT/QTc 130/135–138 (ScanWatch / Body Scan), AFib-from-PPG 139 (ScanWatch),
temperature 12/71/73 (Thermo), glucose 119, urinary 147/148/204/205/248/249/251 (U-Scan).

**Genuinely available from a scale, and unrequested** — which subset arrives depends on the
model, and the superset request costs nothing (see below):

| Type | What | Which scales |
|---|---|---|
| **11** | Heart pulse at weigh-in | Body Cardio, Body Smart, Body Comp, Body Scan |
| **226 / 227** | BMR, metabolic age | Body Comp, Body Scan (model-dependent) |
| **91 / 155** | Pulse wave velocity, vascular age | Body Cardio, Body Comp, Body Scan |
| **167 / 196** | Nerve health / nerve response score | Body Comp, Body Scan |
| **168 / 169** | Extracellular / intracellular water | Body Comp, Body Scan |
| **173–175** | Segmental fat-free mass / fat mass / muscle mass | Body Scan |

Two of those are worth more than they look:

- **Heart pulse (11)** would be the only resting-HR series in the app that *can* be captured
  under controlled conditions — same time of day, fasted, post-void — where Whoop's RHR is an
  overnight average. That makes it a clean cross-check for
  `health_analysis`'s resting-HR-elevation alert, and the module's own docstring already
  advertises it (`withings_client.py:20-21`) while `WITHINGS_MEASTYPES` omits it (`:43`).
  Withings qualifies 11 as "BPM & scale devices only", so handle null.
- **BMR (226)** has no counterpart anywhere in the codebase: `grep` for
  `bmr|basal|tdee|mifflin` returns nothing, so there is **no energy-balance model at all**.
  The fuel plan prescribes carbs/h (`services/nutrition.py`) and nothing prescribes intake.
  If the scale reports BMR, a TDEE becomes arithmetic — and the honest denominator for a
  cut/bulk decision is the one the body-composition electrodes measured, not a formula
  we'd otherwise have to invent.

**The structural blocker, and why it comes first.** Withings is the **only integration that
throws the provider payload away**: `group_measurements` keeps a measure only if its type is
in `_MEASTYPE_TO_FIELD` and silently drops everything else (`services/withings.py:125-126`),
and `WeightLog` has **no `raw_data` column** (`models/weight.py`). So asking `getmeas` for
type 11 today would change nothing — the value would be discarded one function later. The
correct order is: **store the payload first, then widen the request.** Every other provider
already works this way (Strava, Whoop, Komoot and Wahoo payloads all land in `raw_data`), so
this is a consistency fix before it is a feature.

That ordering also answers "which scale is it?" without asking: request the superset once,
store what arrives, and log the observed type set on the first weigh-in. The device tells
you what it has.

Two loose ends this exposes:

- **The BMI derivation is unreachable.** `group_measurements` derives BMI from type 4
  (height) when the same weighing carries it (`services/withings.py:149-152`), but
  `meastypes` never includes 4, so the API filters it out before the code can see it. Dead
  branch, and a good illustration of the same mistake made three times in one path: filter
  at the API, filter again in `group_measurements`, then discard the payload.
- **A second weigh-in in a day silently overwrites the first** — the unique key is
  `(user_id, date, source)` and `group_measurements` computes a `timestamp` that the upsert
  never stores (`withings.py:271-284`; `models/weight.py` has no timestamp column). Once
  type 11 is mapped, an evening weigh-in would overwrite the morning's standardised pulse
  with an evening one — which destroys exactly the property that makes weigh-in RHR useful.
  Either store the timestamp and prefer the first reading of the day, or make that choice
  explicit.

**Also exposed, and not worth having without the hardware**

- **Sleep v2** (`user.activity`) and **activity** — the scale does not measure either; any
  sleep data in the account would come from a mat or a watch, and steps from phone
  tracking. Given a 24/7 Whoop strap, ignore.
- **`notify` webhooks** — appli codes: 1 weight/body comp, 2 temperature, 4 BP & HR,
  16 activity, 44 sleep summary, **46 user-profile change (`action=delete|unlink|update`)**,
  54/55 ECG completed/failed, 62 HRV, 50–52 bed in/out. There is **no workout appli** —
  workouts are polled. Withings documents **no signature or HMAC on webhook bodies** (only
  API *requests* are signed, via `signature_type=hmac_sha256` + `getnonce`), so a handler
  verifies by re-fetching, not by trusting the payload. Only two of those appli codes can
  ever fire for a scale: **1** (a weigh-in, which the 30-minute poll already catches) and
  **46** (unlink — the Withings-side deauthorization signal, the same shape as Strava's
  `athlete` webhook). So the webhook is worth exactly one thing: knowing the grant was
  revoked without waiting for a 401. `plans/withings-integration.md:353` deferred this as
  "polling every 30 min is sufficient for daily weigh-ins", which remains true for weight
  and is only slightly untrue for unlink detection.

### 3.5 Komoot

Reverse-engineered v007 (`api.komoot.de`, or `www.komoot.com/api/v007` as our client uses),
undocumented, Cloudflare-fronted. We use geometry, elevation and surface; everything else is
preserved in `Route.raw_data` and unread.

**Exposed, unused** — the planned-tour payload carries fields we compute by hand elsewhere:

- **`difficulty {grade, explanation_technical, explanation_fitness}`** — Komoot's own
  technical (`dj#t3`) and fitness (`d#c3`) grading. `frontend/src/lib/routeUtils.ts` derives
  difficulty from elevation-per-km; this is the provider's answer, and the two will disagree.
- **`way_types[] {type: wt#street | wt#track | wt#alpine_hiking_path, amount}`** — the road
  character split, which `road_matching` reconstructs from OSM edges.
- **`time_in_motion`, `kcal_active`, `pause_events[]`, `status`** (privacy),
  `_embedded.creator.is_premium` — unused.

**Two things to check before trusting this integration**

- `komoot_client.get_surface()` calls `/tours/{id}/surface` (**singular**, no trailing
  slash); the path maintained clients use is `/tours/{id}/surfaces` (**plural**). The call
  is wrapped in a try/except that logs at `debug` (`services/komoot.py:288-295`), so if it
  404s it is invisible. It is a *fallback* only — the working path is the inline
  `summary.surfaces` list that `tests/test_komoot_surface.py` pins — so the dead call has
  cost nothing but should be deleted or fixed rather than left looking functional.
- There is **no** per-tour `segments`, `highlights` or `photos` endpoint. `segments` in a
  Komoot route payload is routing *provenance* (`{type: "Routed"|"Manual", from, to}`), not
  a Strava-style effort; per-tour images are `/cover_images/`, user-level highlights are
  `/users/{id}/highlights/`. Any plan that assumed Komoot segments would have found a
  routing artefact.

**Verdict: leave it as the surface/difficulty provider it is.** `difficulty` and
`way_types` are the only two fields worth a follow-up, and both are cheap reads of data
already in `raw_data`. The rest is the least stable part of an already-unstable API.

### 3.6 Open-Meteo

Used: forecast, archive, daily aggregates, elevation (frontend).

**Exposed, unused**

- **Air quality API** (`air-quality-api.open-meteo.com/v1/air-quality`) — hourly
  `pm2_5`, `pm10`, `european_aqi`, `us_aqi`, `uv_index`, plus **pollen** as
  `alder_pollen`, `birch_pollen`, `grass_pollen`, `mugwort_pollen`, `olive_pollen`,
  `ragweed_pollen` in grains/m³. Pollen is **CAMS Europe only** — 0.1° / ~11 km, 4-day
  forecast, data from Oct 2023, updated daily; the global domain has no pollen. Fine for a
  UK account, and the limitation belongs in the UI copy rather than in a silent null.
  This is a genuinely new explanatory variable: a June ride at 30 W lower is currently
  attributed to temperature or wind; grass pollen is a competing hypothesis we cannot see —
  and `weather_analysis` would happily regress power onto temperature while pollen carries
  the real effect.
- **Hourly** temperature/wind/precipitation — we store daily means, so an evening ride is
  attributed the day's average wind. The archive and forecast endpoints both serve hourly
  in the same call (`hourly=` alongside `daily=`).
- **Geocoding API** — lat/lon → place name. `prototype/segments/fixture/PROVENANCE.md:20`
  shows a single-use Nominatim call for 77 climb midpoints; Open-Meteo geocoding is the
  same shape without Nominatim's (stricter) usage policy.

### 3.7 Google, Modal, TypeSafe, R2

- **Maps Platform is restricted to 4 services, but the key is not in `.env.example`** and
  `frontend/src/components/relive3d/Relive3D.tsx:141-145` treats a missing
  `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` as a hard error ("Google Maps key not configured") with
  no terrain fallback in that component. `docs/GCP-AUDIT.md` F5 records the key as dead
  config. That is a config gap, not a capability gap — and it is already metered: the
  monthly open-cap (`map_budget`) exists precisely because 3D tiles are billed per load.
- **Gemini is used as a summariser and a video analyst, never as a parser.** The one place
  it would earn its keep is turning a photo of a whiteboard/notebook/coach's plan into
  structured sets — the manual-entry path is the slowest thing in the lifting flow, and we
  already own the prompt/guard/retry infrastructure in `video_analysis.py`.
- Modal workers are all used. `docs/GCP-AUDIT.md` F4 notes BigQuery et al are enabled and
  empty — not worth using.

---

## 4. Opportunities, ranked

Effort: XS ≤ half a day · S ≤ 2 days · M ≤ a week. Value is judgement, stated as the
decision it changes. The `#` is a stable id used in cross-references, not a rank — after the
Withings hardware correction, #8 sits lower than its number implies: it is a hygiene fix with
one small feature attached, not a Medium-value item.

| # | Opportunity | Effort | Value | Data needed | Prereq |
|---|---|---|---|---|---|
| 1 | **Power provenance** — record `device_watts` as `activities.power_provenance`, expose it on the read contract. ~~Exclude it from CP/W′/PR fits~~ — **wrong, see §4 note** | XS | High — every power number becomes either measured or honestly labelled | already in `raw_data` | none |
| 2 | **Whoop bulk recovery + SpO2 + skin temp** — replace the per-cycle N+1 with `/v2/recovery`; store both new signals; feed the illness composite | S | High — fewer calls *and* the two best early-illness signals we don't have | 2 columns on `DailyMetric` | migration |
| 3 | **Gear & wear** — `gear_id` → gear table, `GET /gear/{id}` distance, wear thresholds, chain/shoe alerts | S | High — the only maintenance loop a cyclist actually wants | `raw_data` + 1 call per gear item | migration |
| 4 | **Whoop sleep-need decomposition** — store `sleep_needed.*`, `sleep_performance`, `sleep_consistency`, `disturbances` | S | Medium-High — replaces a hand-rolled debt model with the provider's, and explains it | `SleepLog`/`DailyMetric` columns | migration |
| 5 | **Strava streams: `latlng` only** — shipped. ~~`temp`, `grade_smooth`~~ dropped: no consumer exists, so asking for them would add stored-never-read streams | XS | Medium — zero extra calls; replay uses recorded GPS instead of resampling the route shape | none (new rides only — no stream-backfill task exists) | none |
| 6 | **Wahoo weight write-back** — push the scale's weight to Wahoo (and optionally Strava `PUT /athlete`). ~~FTP/zone push~~ **already shipped** as migration `103` (`/cycling/wahoo-zones`) | S | Medium — the head unit stops estimating calories and W/kg from a weight typed months ago | scopes already granted (`user_write`, `profile:write`) | none |
| 7 | **Whoop + Wahoo webhooks** — mirror the Strava queue pattern; handle `.deleted` | M | Medium — 30 min → seconds, and deletions stop lingering | endpoint + queue table | #2 helps |
| 8 | **Withings: store the payload, then ask for the scale superset** — ~~add `WeightLog.raw_data`~~ **shipped** (migration `108`, superset `meastypes`, observed-type log); remaining: map heart pulse (11) and BMR (226) into columns. **Do not** build BP/ECG/AFib (hardware-gated, §3.4) | S | Low-Medium — a standardised morning RHR and the app's only path to a measured BMR | `meastypes` + `raw_data` column | migration; store before requesting |
| 9 | **Open-Meteo air quality/pollen** — daily pollen+AQI, activity-level attribution, "high pollen today" | S | Medium — a competing explanation for performance dips | new daily + activity columns | migration |
| 10 | **Strava laps → real interval structure** — `start_index`/`end_index` per lap replaces the ten equal-time slices in `pacing_analysis` | M | Medium — a 4×8 session is currently indistinguishable from a steady ride with variable power | 1 call/ride (read budget) | none |
| 11 | **Photo → structured session (Gemini)** — whiteboard/notebook/plan screenshot to sets | M | Medium-High — removes the slowest manual step | Gemini (already paid) | scope storage |
| 12 | **Whoop-only workout fallback** — ingest a Whoop ride with no Strava twin instead of dropping it | S | Low-Medium — completeness of load, with no GPS | none | #2 |
| 13 | **Strava write-back** — manual/FIT/lifting sessions → Strava; `PUT /activities` edits | M | Low-Medium — closes a one-way loop, needs re-consent | `activity:write` | §5.1 |
| 14 | **Disconnect revokes the grant** — `POST /oauth/revoke` (Strava), `DELETE /v2/user/access` (Whoop), `DELETE /v1/permissions` (Wahoo), `oauth2 action=revoke` (Withings) | XS | Low but cheap — a disconnect that actually disconnects | none | none |
| 15 | **Proactive deauthorization** — Strava `athlete` webhook + Withings `appli=46 action=unlink`; today a revoked grant is discovered by a 401 | XS | Low-Medium — connection health stops being reactive | none | none |
| 16 | **Komoot `difficulty` + `way_types`** — reuse the provider's own grading instead of elevating-per-km heuristics | XS | Low — a second opinion on route difficulty, already in `raw_data` | none | none |

### What #1 and #2 look like, concretely

**#1 Power provenance — as built, and what the first draft got wrong.** Shipped:
`activities.power_provenance` (`measured` / `estimated` / NULL), set from
`device_watts` at the three Strava write paths (`sync` create, `sync` merge, webhook
merge), from the FIT import, and from Wahoo's summary; backfilled from `raw_data` in
migration 107 (no Strava calls); exposed on `ActivityRead`/`ActivityDetailRead` and the CSV
export; `power_provenance` added to `_MERGE_FIELDS` so it travels with `average_power`
across providers.

The name is `power_provenance`, not `power_source`: `tss_source` already uses the value
`"power"`, and `power_models` returns `maximal_power_source`. The first draft said
`power_source` and would have collided with both.

**What the draft got wrong:** "exclude it from CP/W′/PR fits" was aimed at consumers that
never see an estimate. Every stream-derived metric — power curve, CP/W′/Pmax,
`check_and_record_cycling_prs`, zones, decoupling — reads `watts` streams, and an estimated
ride has no `watts` stream (Strava does not synthesise one). `_compute_power_curve_alltime`
pre-filters on `average_power IS NOT NULL` but only ever reads streams, so it is safe for
the same reason. A `measured_power_clause()` was written and then deleted rather than
shipped unused.

The real exposure is the **summary** consumers, which read `average_power` /
`normalized_power` directly: TSS (`tss.py`), the Modal weather regression
(`scheduler.py` passes `avg_watts`), plan conformity, and fuel targets.

**Decision (2026-11-05): filter the weather sample, label the rest.** The weather
correlation is the one place an estimate *fabricates* signal rather than adding noise — the
estimate is derived partly from heart rate, heart rate rises with heat, so the fit sees HR on
both axes and can produce a temperature–power coefficient that is really "it was hot, your HR
was up, and your watts were made of HR". Its sample is now filtered by
`measured_power_clause()` (NULL-safe, so pre-migration-107 rows stay in) and the task logs how
many rides it dropped.

TSS, conformity and fuel targets keep the number and carry the label. The deciding argument
is history, not principle: TSS is stored per activity and feeds CTL/ATL, so a rule applied
only to newly synced rides would leave one load series built from two models, and recomputing
the old rows would rewrite training history to fix a second-order accuracy issue. hrTSS is
also a coarse %HRR model — swapping a reasonable estimate for a coarser one is not obviously
an improvement. `tss_source="power"` + `power_provenance="estimated"` reads as "power (est.)",
which is honest without redefining anyone's past.

So `measured_power_clause()` — written, deleted as unused, then rewritten when a caller
appeared — now has exactly one consumer, and that is the right number.

**#2 Whoop recovery — as built.** Shipped: `whoop_client.get_all_recovery()` over
`/developer/v2/recovery`; `sync_whoop_cycles` prefetches the window once and joins by
`cycle_id`, deleting the per-cycle request loop and its sleeps (~25× fewer requests for the
same data). `_recovery_fields()` is now the single projector for **three** call sites — the
scheduled sync, `backfill_whoop_data` and `_backfill_missing_recovery` — which had each
hand-picked their own four of the score's seven fields; that divergence is why SpO2 and
skin temperature were never collected. `spo2_percentage` + `skin_temp_celsius` land on
`DailyMetric` (migration 109) and vote in `_illness_composite`.

Three decisions worth recording:

- **A prefetch failure degrades to cycle data only**, logging a warning; the existing gap
  filler then retries each missing recovery through the *per-cycle* endpoint. So the
  fallback is a path that already exists and is exercised, not new code written for a case
  we hope never happens.
- **Skin temperature is stored absolute, the baseline computed on read.** Absolute values
  vary by person, bedding and room; storing a delta would freeze in whatever baseline
  existed the day the row was written.
- **The SpO2 rule was wrong in the first draft, and a test caught it.** "Two readings" was
  meant as "one bad night is not evidence", but the implemented gate was *two observations*,
  so `[97, 88]` scored 100. The rule is now two readings **below 95%** among the last three,
  banded on the worst. The test that failed is the one that documents it.

Composite weights: recovery 25 / RR 20 / HRV 25 / sleep 15 / fatigue 15, plus SpO2 10 and
skin temp 10 when present. Adding a vote dilutes the others proportionally (full-data total
1.20) rather than rescaling them, and every signal still drops out of the denominator when
absent — so a strap with no SpO2 scores exactly as it did before, which is asserted.

Not done, deliberately: rows written before migration 109 have NULL SpO2/skin temp and will
not gain them — the gap filler only revisits rows missing `recovery_score`, and backfilling
two optional fields would mean re-fetching every cycle ever recorded. The signal is about
the last week, so the history is not worth it.

The pattern to keep: **every composite must degrade per-signal and say so** (pitfall 42's
lesson, applied to inputs rather than engines).

### What #5 turned out to be

The first draft asked for three stream keys because `keys` is comma-separated and costs no
extra request. Two of the three have no reader: nothing consumes a `temp` or `grade_smooth`
stream anywhere in the codebase (FIT imports write a `temperature` stream and nothing reads
it either). Adding them would have produced exactly the failure mode §2 is about, one layer
down.

So `latlng` shipped alone — it has a live consumer (`services/replay.py` prefers recorded GPS
and otherwise interpolates the route polyline, which resamples a *shape* and loses
switchbacks and any detour off the matched route) — and the absence of the other two is now
asserted in `tests/test_strava_streams.py` with the reason. When a reader for temperature
lands, deleting that assertion is the deliberate act of adding the key.

Scope note: there is no stream-backfill task, so existing rides keep interpolated geometry.
That is the right default — backfilling would cost one read-bucket call per ride against a
1,000/day limit for a cosmetic gain.

### What #3 needs beyond the field

`gear_id` is a Strava id; the durable object is *the bike in the garage*. A `Gear` table
(`provider`, `provider_gear_id`, `name`, `kind`, `distance_m`, `retired_at`,
`wear_threshold_m`) plus `Activity.gear_id` lets shoe mileage survive a gear rename and lets
a chain-wear alert fire on `distance` deltas rather than a stored total. `PUT
/activities/{id}` can correct a mis-assigned ride, but only with `activity:write` — so
`Gear` should start read-only.

---

## 5. Cross-cutting prerequisites

### 5.1 `OAuthConnection` does not store granted scopes

`schemas/auth.py:31-43` exposes no scopes, and nothing captures what the provider actually
granted. That is fine while every call is a read. It blocks every write opportunity (#6,
#11, #13): you cannot render "Reconnect to enable route push" without knowing whether the
existing grant carries `activity:write`, and you cannot tell a scope failure from a token
failure. Add a `scopes` column, populate it from the token response where available
(Strava returns `scope`), and treat a missing row as "unknown, offer reconnect".

Related: there are **two** Strava authorize-URL builders that disagree —
`services/auth.py:75-82` requests `read,activity:read_all` (the one actually used, via
`api/auth.py:147`), while `integrations/strava_client.py:27-33` requests
`read,activity:read_all,profile:read_all` and is dead. Deleting the dead one is part of the
same tidy-up: the next person to add a scope would otherwise patch the wrong file and see
nothing change.

### 5.2 One webhook ingestion pattern, four providers, three verification schemes

Strava already has the right shape (`api/webhooks.py` verifies and queues;
`services/strava/webhook_queue.py` drains under a Celery task; the POST never does work).
The others differ only in verification and decoding: **Whoop** signs (`X-WHOOP-Signature` =
base64 HMAC-SHA256 of `timestamp + body`, dedupe on `trace_id`), **Wahoo** shares a plain
`webhook_token` in the body with no signature at all, and **Withings** sends nothing
verifiable, so the handler must treat the body as a *hint* and re-fetch. Building #7 as
three bespoke handlers would triple the surface for the same queue; use one
`webhook_events` table with a `provider` column and a per-provider verify function that
returns "trusted" or "hint only", and keep the "verify + enqueue only" invariant that
pitfall 9 already enforces for Strava.

That last point is not cosmetic: a Withings handler that trusts the payload would let any
caller mark a weigh-in or unlink a connection.

### 5.3 Rate-limit budget is a design input, not an afterthought

- Strava read: 100 / 15 min, 1,000 / day. Extra stream keys are free; extra calls are not.
- Wahoo production: 200 / 5 min, 1,000 / h, 5,000 / day; CDN FIT downloads are free.
- Whoop: no published limits; our own `asyncio.sleep` between recovery calls is a guess.
  #2 removes most of that traffic.

### 5.4 Make "we store it but never read it" a test, not a habit

The provider payload is an external contract. Today, adding a provider is a leap of faith
that someone remembers every field worth keeping. A cheap structural check: per provider, a
declared set of *mapped* and *deliberately-ignored* fields, with a test that fails when a
field appears in a fixture payload and in neither set. It would have caught `device_watts`
and `gear_id` on day one, and it makes the next provider review a diff instead of a
recollection. (Same instinct as pitfall 37, inverted: there, a column was read but never
written; here, a field is written but never read.)

---

## 6. Deliberately not worth doing

| Thing | Why not |
|---|---|
| Strava segments, leaderboards, Segment Explore | Not in the API / subscription-gated / Extended-Access only since 2026-09-01. We already build climbs and a leaderboard-of-self from streams |
| Strava clubs, kudos, comments, photos, running races | Social/dead surfaces; adds an account graph this app does not have |
| Strava athlete stats | Duplicates our own aggregates, and only counts Everyone-visible activities |
| Strava `suffer_score` | Null for non-subscribers |
| Komoot cover images, tour FAQs, translations, user highlights | Presentation surfaces for a route-planning app; no analytical content |
| Withings sleep/activity/intraday | The scale measures none of them — any such data would come from a mat, a watch or phone step-tracking we don't have. Overlaps Whoop even if added |
| Withings BP, ECG, AFib, temperature, urinary | Hardware-gated: needs a BPM cuff, ScanWatch/Body Scan, Thermo or U-Scan. Not a capability gap, and a UI offering them would be a lie |
| BigQuery / the 30 other enabled GCP APIs | Enabled, empty, no product need (`docs/GCP-AUDIT.md` F4) |
| Replacing OSM tiles with a keyed provider | Already possible via `NEXT_PUBLIC_MAP_TILES`; only worth it if usage grows past the OSM tile policy |
| Adding a provider (Garmin, Oura, Apple Health) | Nothing in §4 needs one. The missing signal is not a missing device |

---

## 7. Maintenance watch

- **Strava base URL moves to `api-v3.strava.com` on 2027-01-04.** `strava_client.py:17`
  hardcodes `www.strava.com/api/v3`; make it configurable now so the move is a config
  change, not a redeploy under pressure.
- **Wahoo token rules** (from 2026-01-01): ≤10 unrevoked tokens per user, tokens
  auto-deleted 60 days after creation, and a refresh only takes effect when a call is made
  with the new token. Our "refresh on expiry, then call" order is compatible; polling more
  often than the access-token lifetime is what would leak tokens.
- **Whoop v2 migration is complete** in our client (all paths are `/developer/v2`), and v1
  webhooks are gone — relevant only because it means any future webhook work starts on v2.
- **`README`/`.env.example` gaps**: `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`,
  `NEXT_PUBLIC_MAP_TILES` and `NEXT_PUBLIC_MAP_ATTRIBUTION` are read by the frontend but
  undocumented in `.env.example`.

---

## 8. What I could not confirm

Recorded so nobody builds on a guess:

- **Whoop rate limits** are not published anywhere in the developer docs. Our
  `asyncio.sleep` between recovery calls is a defensive guess, not a documented requirement
  — which is another argument for #2 removing the loop.
- **The scope for `GET /gear/{id}`** is not stated in any source I could load. If it turns
  out to need `profile:read_all`, #3 needs a re-consent rather than a free call.
- **Which Withings scale model is connected**, and therefore which of types 11/91/155/
  226/227/167/196/168/169/173–175 it actually emits, is unknown — the body-composition
  types above (5/6/8/76/77/88/170) are the only ones confirmed to arrive. #8 is designed
  not to need the answer: store the payload, request the superset once, and log the observed
  type set rather than guessing.
- **Withings does not document a webhook signature.** "Unsigned" is inferred from the
  documented payload schema, not from a paragraph saying so. Treat re-fetch verification as
  required either way.
- **`/tours/{id}/surfaces` (plural)** is the path maintained clients use; ours asks for the
  singular. One live request settles it — see §3.5.
- **Open-Meteo**: the air-quality/pollen page was verified directly; the forecast/archive/
  geocoding pages and the pricing terms were not re-fetched in this pass, so the "same call,
  hourly" claim rests on the existing `services/weather.py` usage pattern rather than a
  fresh read of the docs. Worth a re-check before relying on a new hourly field.
- **Strava's swagger models are behind its own sample payloads** (`pr_count`,
  `suffer_score`, `device_watts` and others appear in samples but not in the schema). Any
  field audit built on the OpenAPI spec (§5.4) must be built on the *fixtures*, not the spec.

---

## 9. If only three things get done

1. **#1 power provenance** — smallest change, largest correction to numbers the app already
   shows as fact.
2. **#2 Whoop bulk recovery + SpO2/skin temp** — deletes an N+1 and adds two signals the
   health engine is missing, in one migration.
3. **#5 + #3** — three stream keys and a gear column, both nearly free, and together they
   fix the replay geometry and start the only maintenance loop the app lacks.
