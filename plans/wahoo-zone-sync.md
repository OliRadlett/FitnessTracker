# Push power / HR zones to Wahoo (auto-adjust on FTP & LTHR change)

> **Status**: Phases 1 and 2 **backend landed** on `feature/wahoo-zone-sync`
> (2026-10-16): migration 100, model/schemas, the power-zone client read/write,
> `GET /cycling/wahoo-zones`, `POST /cycling/wahoo-zones/push`, `POST
> /cycling/wahoo-zones/revert`, the automatic trigger from the four FTP write sites,
> and a `wahoo_zones` notification. The card is in progress; Phase 3 (HR) is
> unchanged and still **not** built.
> **Phase 0 (the sandbox spike) is still open.** It no longer blocks shipping — the
> write path was built to be convention-agnostic (D2) so a wrong guess about
> `zone_N` cannot reshape an athlete's zones — but it still decides two things:
> whether writing `ftp` alone recomputes boundaries, and what
> `GET /v1/power_zones` actually returns (which is what D3's creation path and the
> read-only card exist to reveal). See §3.1 and §11.
> **Scope**: keep the athlete's Wahoo zone sets in step with FitTrack's FTP / LTHR,
> so the ELEMNT colours the current zone against the *right* boundaries and pushed
> structured workouts target the intended watts.
> **Builds on**: [`wahoo-planned-workout-push.md`](wahoo-planned-workout-push.md)
> (write path, typed errors, scope table) and the FTP write sites
> (`PATCH /cycling/profile`, `POST /cycling/ftp-history`, `POST /cycling/estimate-ftp`,
> `auto_estimate_ftp_weekly`).

---

## 1. Why

The head unit shows the current power/HR **zone colour** for the live effort. That
colour is computed from the *zone set stored on the Wahoo side*, not from FitTrack.
Two consequences today:

1. **Stale anchor → wrong colours.** Our weekly `auto_estimate_ftp_weekly` task
   silently moves FTP (e.g. 250 → 268 W). FitTrack's charts immediately use the new
   FTP; the ELEMNT keeps colouring against 250 W until the user re-enters it by hand
   in the Wahoo app. Every zone boundary is ~7% off.
2. **Pushed workouts are affected too.** `wahoo_plan_file.build_plan_json()` emits
   targets as *fractions of FTP* ("Z2" = 55–75%). The device resolves those fractions
   against **its own** FTP, so a stale device FTP makes a pushed "Z2" session ride
   the wrong watts — the plan file is current but the intensity is not.

So the feature is not cosmetic: it closes the loop between the FTP we already
auto-maintain and the device that displays it.

---

## 2. Goal / UX

On the **Cycling** page, under `ProfileEditor`, a new **Wahoo Zones** card:

```
┌ Wahoo Zones ─────────────────────────────────────────────────────────────┐
│ [x] Keep my Wahoo zones in sync with FitTrack                            │
│     Updates FTP/THR and zone boundaries on your ELEMNT when they change. │
│                                                                          │
│ Power (cycling)          FitTrack      Wahoo        Drift                │
│   FTP                    268 W         250 W        ⚠ -18 W              │
│   Z1 upper …             …             …            …                    │
│                                                                          │
│ Heart rate (cycling)     FitTrack      Wahoo        Drift                │
│   LTHR/THR               172 bpm       —            not available via API│
│                                                                          │
│ [ Push power zones now ]  [ Revert to previous Wahoo zones ]             │
│ Last pushed 2h ago · schedule: weekly                                     │
└──────────────────────────────────────────────────────────────────────────┘
```

- The toggle is **opt-in, default off** (we are writing to a third-party account).
- The card shows a **fit/drift diff** so the user can see what a push would change
  *before* it happens; "Push now" performs it.
- After an automatic push, a notification ("Your Wahoo power zones were updated to
  268 W") so the change is never silent.
- **Revert** restores the snapshot taken before our first write.

---

## 3. Wahoo API contract

Verified against <https://cloud-api.wahooligan.com/> (fetched 2026-10-15) and the
OpenAPI mirrors at <https://apis.io/apis/wahoo/wahoo-power-zones-api>.

### 3.1 Power zones — documented, scoped, unverified in detail

| Op | Endpoint | Scope |
|----|----------|-------|
| List | `GET /v1/power_zones` | `power_zones_read` |
| Get | `GET /v1/power_zones/{id}` | `power_zones_read` |
| Create | `POST /v1/power_zones` | `power_zones_write` |
| Update | `PUT /v1/power_zones/{id}` | `power_zones_write` |
| Delete | `DELETE /v1/power_zones/{id}` | `power_zones_write` |

Request fields (form-encoded, same shape as our existing `plan[…]`/`route[…]` calls):

| Field | Meaning (per docs) |
|-------|--------------------|
| `power_zone[zone_1] … [zone_7]` | zone thresholds (numbers) |
| `power_zone[zone_count]` | number of zones in the set |
| `power_zone[ftp]` | Functional Threshold Power |
| `power_zone[critical_power]` | "MMP/Best average power" |
| `power_zone[workout_type_id]` | e.g. `0` BIKING, `12` BIKING_INDOOR |
| `power_zone[workout_type_family_id]` | `0` = BIKING |
| `power_zone[workout_type_location_id]` | `0` indoor, `1` outdoor, `255` unknown |

Response adds `id`, `user_id`, `originator_type`, `fitness_app_id`, timestamps.

**Unverified, and each one changes the design** (§11 spike):

1. **Is `zone_N` a lower bound, an upper bound, or a centre?** The docs' own example
   passes `zone_1..zone_7` *and* `zone_count=8`, so the count and the boundary list
   do not agree — reading a set back after writing a known ladder is the only way to
   learn the convention.
2. **Does writing `ftp` alone re-derive the boundaries server-side?** The docs'
   "Update a Power Zone" example writes `power_zone[ftp]=300` only and returns the
   *old* boundaries — i.e. the example is consistent with "no recompute". If it
   does not recompute, an FTP-only push silently leaves the zones stale.
3. **Does `GET /v1/power_zones` return sets owned by other apps / the Wahoo app
   itself?** Routes and plans are explicitly restricted to the calling app; power
   zones say only "for the authenticated user". This decides whether we can read
   the athlete's real set or only our own.
4. **There is a docs bug**: the HTTP Request line for Update says
   `POST /v1/power_zones`, while its curl (and the OpenAPI mirror) say
   `PUT /v1/power_zones/{id}`. Trust the curl/OpenAPI; confirm on the sandbox.
5. **Can we delete/overwrite a set we did not create?** `originator_type` and
   `fitness_app_id` (`<1000` = Wahoo app, `>1000` = third party) are the only
   provenance signals available.

### 3.2 Heart rate zones — **no documented endpoint**

Checked exhaustively:

- The docs' nav and body list **only** a "Power Zones" section. There is no
  `heart_rate_zones` resource.
- The scope table has `power_zones_read` / `power_zones_write` and **no HR
  equivalent**; the full 12-scope set is what our OAuth request already sends
  (`integrations/wahoo_client.py:71`, `services/auth.py:90`).
- `PUT /v1/user` (`user_write`) accepts **only** `first`, `last`, `birth`, `gender`,
  `height`, `weight` — verified from the Users OpenAPI mirror. It cannot set THR or
  HR zones.
- The changelog (back to 2025-03) never added an HR-zone endpoint.
- Wahoo's own app derives HR zones from a **THR** anchor with auto-detection and
  multiple per-sport sets — an app/device-side model, not an API surface.

So the premise "HR zones can be adjusted using the API" is **not supported by the
published Cloud API**. Two possibilities remain, both cheap to test and both in the
spike: an **undocumented** path (`GET/POST/PUT /v1/heart_rate_zones`, or a
`heart_rate_zones` key under `user_write`), or a native-SDK-only path (out of reach
for a server-side integration). If neither works, HR ships as **drift detection +
guidance** (§8, D6) rather than a push.

### 3.3 How Wahoo builds HR zones (app behaviour — shapes what we would write)

Source: Wahoo Fitness Support, "HR, Power and Pace zones [Wahoo app]" (fetched
2026-10-15). The three zone families are **structurally identical** — each set is
*a single anchor plus derived boundaries*:

| Family | Anchor | Derived from anchor |
|--------|--------|--------------------|
| Power | **FTP** (default 200 W on new accounts) | zone values auto-calculated from FTP |
| **Heart rate** | **THR — Threshold Heart Rate** (default from biometrics/age on new accounts) | **zone values auto-calculated from that THR** |
| Pace | TP — threshold pace | zone values auto-calculated from TP |

Specifics that matter for this feature:

- **Yes — Wahoo anchors HR on a threshold, not on max HR.** The set stores a **THR**;
  "the heart rate zone data can now be auto-calculated from a THR value". The athlete
  can then override individual *lower thresholds*, and "individually change the lower
  threshold value for each zone, which will automatically change the upper threshold
  of the zone below" — the same lower-bound cascade the power-zone API exposes as
  `zone_1 … zone_7` (which is strong evidence for §3.1.1's convention).
- **Multiple HR sets, per sport, assigned to workout profiles** — "distinct zone sets
  for cycling, running, and swimming", each profile must have one, and the **Default**
  set cannot be deleted. So "the cycling HR zones" is not a single row, and a push
  would have to pick the set(s) the cycling profiles are bound to.
- **Our `lactate_threshold_hr` is the same physical quantity as Wahoo's THR** — the
  HR sustainable for ~60 min, which Half Monty / Full Frontal derive. Unlike power
  (where we hold a Coggan model, an FTP *and* a Morton CP), HR maps **1:1**: one
  number in, one number out. That makes HR the *simpler* of the two to sync — if an
  API surface exists.
- **A legacy path still exists**: older ELEMNT-app guidance auto-calculates HR zones
  from **max + resting HR**, and Wahoo's own blog expresses HR bands as **% of LT**
  (Z1 <70%, Z2 70–80%, Z3 87–95%, Z4a 95–100%, Z4b 100–105%, Z5 105–max). So an
  existing set may be anchored on THR *or* on max/resting, and its shape may be
  Wahoo's (above) or the athlete's own edits. This is the same trap as power and
  reinforces D2: **rescale the set's own shape, never impose ours.**
- **Our HR boundaries are materially different** from Wahoo's published bands
  (`LTHR_HR_ZONES`, `services/cycling/zones.py:35`): we use 80 / 89 / 95 / 105 %
  against their ~70 / 80 / 87–95 / 95 / 105 %. Our Z1/Z2 split sits ~10 points
  higher, so imposing our model would visibly reshuffle the colours the athlete
  trains by — the clearest case yet for D2.
- **Still no API surface.** This is app behaviour; the head unit gets zones through
  the app, and none of it is exposed in the Cloud API. Worth noting for the spike:
  the power-zone endpoint proves Wahoo's backend *has* an anchor-plus-boundaries zone
  model per family, so asking Wahoo for `heart_rate_zones_*` scopes (or a Plans-style
  entitlement — `partnerships@wahoofitness.com`) is a legitimate request rather than
  a long shot.

---

## 4. Pre-implementation state

| Need | Exists? | Where |
|------|:-------:|-------|
| Wahoo OAuth + token refresh | Yes | `integrations/wahoo_client.py`, `services/wahoo.py:128` (`refresh_if_needed`) |
| Wahoo power-zone client methods | **No** | none — the scope is requested but unused (`wahoo-planned-workout-push.md:47-48`) |
| Typed push errors | Yes | `services/wahoo_push.py:43` (`WahooPushError(status_code, code)`) — reuse the shape |
| Opt-in flag precedent | Yes | `CyclingProfile.auto_estimate_ftp` (`models/cycling.py:42`) + toggle in `ProfileEditor.tsx:143` |
| FTP auto-estimate (weekly) | Yes | `auto_estimate_ftp_weekly` (`tasks/scheduler.py:2959`), beat `:246` (Sun 04:00) |
| FTP write sites | Yes | `api/cycling/__init__.py:44`, `api/cycling/ftp.py:65`, `:135`, `:321` |
| FTP model + history | Yes | `CyclingProfile.ftp_watts/critical_power` (`models/cycling.py:37,46`), `FtpHistory` (`:98`) |
| Power zone maths (Coggan 7-zone) | Yes | `POWER_ZONES` (`services/cycling/zones.py:13`) |
| Prescription zone maths (z1–z5 IF) | Yes | `WORKOUT_ZONES` (`services/workout_planner.py:20`) |
| HR zone maths (5-zone, LTHR) | Yes | `LTHR_HR_ZONES` + `compute_hr_zones_from_lthr` (`services/cycling/zones.py:35,44`) |
| Wahoo zone read/write | **No** | this feature |
| Revert/snapshot mechanism | Partly | `UndoLog` (§8) exists but has **no HTTP surface and no registered kind** — deliberately not used here (§7, D4) |
| Notification plumbing | Yes | 4 sync points listed in `plans/future-enhancements.md:212` |

---

## 5. Data model (one migration)

Next free revision is **`100`** at time of writing (head is `099`, and `origin/main`
is also `099`). **Re-check before creating the file** — see AGENTS.md pitfall 34.

### 5.1 `wahoo_zone_sets` (new table)

One row per (user, zone kind, workout-type family, location) — matching Wahoo's own
model, where zone sets are per sport *profile*, so indoor and outdoor cycling can
carry different sets.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | `uuid4` |
| `user_id` | UUID FK `users.id` ON DELETE CASCADE, indexed | |
| `zone_kind` | `String(12)` | `"power"` (HR reserved — no writer until §3.2 resolves) |
| `workout_type_family_id` | `Integer` | `0` = BIKING |
| `workout_type_location_id` | `Integer` | `0` indoor / `1` outdoor / `255` unknown |
| `wahoo_zone_set_id` | `Integer NULL` | Wahoo's `id`; NULL until first create |
| `anchor_value` | `Float NULL` | the FTP (later THR) we last wrote |
| `boundaries` | `JSONB NULL` | exactly what we wrote — drives the card's diff without a live read |
| `prior` | `JSONB NULL` | snapshot before our first write; the revert source |
| `pushed_at` | `DateTime(tz)` | |
| `last_error` | `String(300) NULL` | last non-auth failure, surfaced in the card |
| unique | `(user_id, zone_kind, workout_type_family_id, workout_type_location_id)` | idempotency |

- Declare `boundaries`/`prior` as `JSONB(none_as_null=True)`. Revert **clears**
  `prior`, and without the flag the cleared row still matches `IS NOT NULL`
  (AGENTS.md pitfall 28) — the exact trap migration 092 repaired.
- Register the model in `app/models/__init__.py` (import **and** `__all__`) or
  `create_all()` will not see it (pitfall 14).

### 5.2 `cycling_profiles` (one column)

| Column | Type | Notes |
|--------|------|-------|
| `push_wahoo_zones` | `Boolean NOT NULL default false, server_default='false'` | opt-in; sits beside `auto_estimate_ftp` |

### 5.3 Schemas

- `CyclingProfileRead` / `CyclingProfileUpdate` gain `push_wahoo_zones: bool`
  (`schemas/cycling.py:17,86`).
- New: `WahooZoneSetRead`, `WahooZonesStatus`, `WahooZonesPushRequest/target`,
  `WahooZonesRevertResult` (new `schemas/wahoo_zones.py`).

---

## 6. Backend

### 6.1 Client (`integrations/wahoo_client.py`)

Mirror the existing form-encoded style (`_route_form`, `create_workout`):

```python
async def get_power_zones(self, access_token) -> list[dict]        # GET  /v1/power_zones
async def create_power_zone(self, access_token, payload: dict)     # POST /v1/power_zones
async def update_power_zone(self, access_token, zone_id, payload)  # PUT  /v1/power_zones/{id}
async def delete_power_zone(self, access_token, zone_id)           # DELETE (revert-by-delete, maybe unused)
```

- body is `{f"power_zone[{k}]": str(v) …}`, wrapped in `retry_request` like its
  neighbours; 60s timeout for create (proven by the plan/route calls).
- Add the constants `WAHOO_FAMILY_BIKING = 0`, `WAHOO_LOCATION_INDOOR/OUTDOOR`
  (already exist) and reference `WAHOO_TYPE_BIKING_INDOOR/OUTDOOR` (`:27`) — don't
  re-declare `0`/`12` inline (`wahoo_push.py:101` already hardcodes `# BIKING`).
- **Rate limits** (docs): sandbox 25/5 min, prod 200/5 min. One push is ≤2 calls
  (read + write), so a weekly batch of N users is 2N calls against the prod bucket —
  run the task sequentially (it already is) and treat `429` as "retry next run",
  not an error to escalate.

### 6.2 New service `services/wahoo_zones.py`

```python
class WahooZoneError(Exception):           # mirrors WahooPushError
    def __init__(self, message, status_code=400, code="zone_push_failed"): ...

def zone_boundaries_for_ftp(ftp: float, *, model: str = "rescale") -> dict   # pure
def pick_target_set(sets: list[dict], *, stored_id: int | None,
                    family_id: int, location_id: int) -> dict | None       # pure
async def read_wahoo_zones(db, user_id) -> WahooZonesStatus
async def push_power_zones(db, user_id, *, force: bool = False,
                           locations=(0, 1)) -> dict
async def revert_wahoo_zones(db, user_id) -> dict
```

`push_power_zones` sequence:

1. **Gate**: `CyclingProfile.push_wahoo_zones` is true; `ftp_watts` present;
   connection exists → **no refresh yet** (see below).
2. **Idempotency**: for each target row, skip when
   `round(anchor_value) == round(ftp_watts)`. `force=True` (the manual button)
   bypasses this.
3. **Only now** `refresh_if_needed(db, conn)` — Wahoo caps unrevoked tokens at 10
   per user and invalidates the old token only when the refreshed one is *used*.
   Refreshing without then calling the API is the documented way to exhaust the
   cap, so refresh immediately before the call and never speculatively
   (`wahoo-planned-workout-push.md:46`; `refresh_if_needed` already commits — pitfall 8).
4. **Read** `GET /v1/power_zones`; `pick_target_set` picks (a) our stored
   `wahoo_zone_set_id` if present, else (b) exactly one BIKING set whose
   `fitness_app_id > 1000` (third-party origin), else (c) none → create.
   *Never* touch a non-BIKING family and never touch a `fitness_app_id < 1000`
   set: that is the user's Wahoo-app set and we would be overwriting customisation
   we did not write.
5. **Update or create**, then persist `wahoo_zone_set_id`, `anchor_value`,
   `boundaries`, `pushed_at`, and `prior` **only if empty** (the snapshot is of the
   state before *our* first write — never overwrite it, or revert stops being
   revert).
6. On `403` → `WahooZoneError(..., 403, "missing_scopes")` with the reconnect copy
   from `wahoo_push.py:117`. On other HTTP errors → `last_error` + log; a push
   failure must never propagate into the FTP write path.

Boundary policy is §7 D2; the default is **rescale the existing set's own shape**,
so the push changes the *anchor*, not the athlete's zone model.

### 6.3 Endpoints (`api/cycling/zones.py`, included from `api/cycling/__init__.py`)

| Method | Path | Behaviour |
|--------|------|-----------|
| `GET` | `/api/v1/cycling/wahoo-zones` | card payload: connected?, opt-in, our local zones (power + HR), Wahoo sets, per-row drift, `pushed_at`, `has_prior`, `last_error`. **Read-only, no write, no connection required** |
| `POST` | `/api/v1/cycling/wahoo-zones/push` | **no body** → `push_power_zones(force=True)`. 409 no connection · 403 missing scope · 422 no FTP. Per-set failures come back in `skipped[]`, not as an error |
| `POST` | `/api/v1/cycling/wahoo-zones/revert` | restores each `prior` snapshot and clears it. 409 when there is no snapshot |

- The plan sketched a `{target: "power"｜"all"}` body; dropped, because HR has no
  writable surface at all, so the only meaningful target is power and a body would be
  ceremony around a constant.
- `can_write` on the status payload means "may the athlete press *Push now* now" —
  connection + FTP + no Wahoo-side error, and **not** the opt-in toggle. Gating it on
  the toggle would disable the button that repairs drift for someone who declined
  automation, contradicting D1.
- `PATCH /cycling/profile` accepts `push_wahoo_zones`. When FTP changes, or when the
  toggle is switched **on**, the handler commits and then enqueues — see §7 D5 for
  why the order is load-bearing. The card also pushes immediately on toggle-on, so
  the first sync does not wait for the weekly task.
- Route-ordering: all three paths are **static single-segment**, and the cycling
  router has no `/{param}` route at all, so pitfall 13's collision rule has nothing
  to bite on (pitfall 35). No ordering assertion is added, because it would lock in
  caution while checking nothing.

### 6.4 Trigger wiring (as built)

FTP can change in four places; two helpers keep them in step:

```python
# services/wahoo_zones.py
async def commit_and_enqueue_zone_push(db, user_id, profile) -> bool   # endpoint sites
def enqueue_zone_push_if_opted_in(user_id, profile) -> bool            # weekly task
```

The opt-in check lives inside both, so no call site can forget it.

| Site | Call |
|------|------|
| `auto_estimate_ftp_weekly` (`scheduler.py`, after the per-user commit) | `enqueue_zone_push_if_opted_in` |
| `PATCH /cycling/profile` (FTP changed **or** toggle switched on) | `commit_and_enqueue_zone_push` |
| `POST /cycling/ftp-history` (when it updated the profile) | `commit_and_enqueue_zone_push` |
| `POST /cycling/estimate-ftp?accept=true` (when the estimate differs) | `commit_and_enqueue_zone_push` |
| Manual "Push now" (the card) | inline `push_power_zones(force=True)` so the UI gets the answer |

New task `app.tasks.scheduler.push_wahoo_zones_for_user` (per-user, `task_session()`,
`asyncio.run` — pitfall 1). **Not** a beat entry: it is enqueued, not scheduled, since
the trigger is an FTP change rather than a timetable. It re-checks `require_opt_in`,
so a job queued just before the athlete switched the toggle off cannot still write to
their account. It notifies only when something was actually written, deduped on the
FTP value so a re-run cannot re-announce the same move.

### 6.5 Notification

New type `wahoo_zones` (confirmation of an automatic push; the manual path reports
in the UI instead). Adding a type touches **four** places, per
`plans/future-enhancements.md:212`:

1. `NOTIFICATION_TYPES` — `models/notification.py:13`
2. `DEFAULT_PREFERENCES` — `services/notifications.py:27`
3. `schemas/notification.py` (`:37`, `:48`)
4. frontend — `lib/api/types/notifications.ts`, `lib/notificationMeta.ts`, `components/settings/NotificationSettings.tsx`

Auth failures need **no** new type: `handle_sync_http_error` / `_mark_reauth`
already fire `connection_reauth` for a 401.

---

## 7. Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| **D1** | Opt-in (`push_wahoo_zones`, default off) governs the **automatic** path only. Pressing "Push now" is itself consent, so it does not require the toggle. | Writing into someone else's account unprompted is not acceptable; mirrors `auto_estimate_ftp`, which is also opt-in. But requiring someone to enable *automation* before they may perform the same write by hand is friction with no safety benefit — the manual button is also the path that repairs drift when the automatic push was skipped. |
| **D2** | **Rescale the existing Wahoo set; do not impose our boundaries.** Write `ftp` **plus** boundaries derived from the set's *own* current proportions. Offer Coggan-mode only as an explicit choice. **As built**: `rescaled_boundaries()` multiplies the set's own values by `new_ftp / old_ftp` (monotonicity enforced after rounding); a set with boundaries but no readable anchor is *skipped* rather than half-updated; `critical_power` is never sent; a **created** set gets the anchor and identity only, no invented boundaries. | Our `POWER_ZONES` are Coggan (55/75/90/105/120/150 %FTP); Wahoo's blog model is ~(55/75/91/100/110/135)% with a 4a/4b split. Pushing Coggan boundaries would silently reshape zones the athlete may have tuned — the feature is about the *anchor*, not the model. If §11 spike shows Wahoo recomputes from `ftp`, even simpler: write `ftp` alone. Holds doubly for HR, where our 80/89/95/105 %LTHR bands differ from Wahoo's ~70/80/87–95/95/105 %LT bands (§3.3). The ratio approach is what made shipping ahead of the spike safe: a wrong guess about `zone_N`'s meaning leaves zones uniformly wrong (visible as drift on the card) instead of reshaped. |
| **D3** | Own the athlete's cycling set(s) — **including the set the Wahoo app created** — but never touch a set attributable to *another third-party app*, and never delete a set. A new set is created **only when `GET` returns no cycling set at all**. | **Revised while building.** The first draft of this rule was "never write to a `fitness_app_id < 1000` set", reasoning that it is the athlete's own customisation. That is backwards: the Wahoo-app set is the one the head unit actually colours against, so refusing to touch it would make the feature do nothing in the common case. The real hazard is a *different* third-party app also syncing zones (`fitness_app_id > 1000`, and not one of our tracked ids) — there we would be fighting another integration. What makes writing the athlete's own set safe is opt-in + snapshot + revert, not provenance. The create path exists only because `GET` may be app-scoped (the docs do not say, unlike routes and plans); creating a set alongside sets we merely *declined* to touch would be noise on top of a deliberate delegation, so it does not happen. |
| **D4** | Snapshot + explicit revert instead of `UndoLog`. | `UndoLog` has no HTTP surface and no registered production kind, and `RouteMergeLog` was deliberately **not** migrated onto it exactly because a 30-day expiry would be imposed on a working undo (`AGENTS.md`, Active Planning). A `prior` JSONB column plus a revert endpoint is honest and non-expiring. |
| **D5** | Automatic pushes are **queued from the endpoint sites** (`commit_and_enqueue_zone_push` commits the FTP change *before* enqueueing) and queued from the weekly task after its own commit. Manual push is inline, because the athlete is waiting for the answer. **Not** inline for automatic pushes. | **Revised while building.** The first draft said "inline for user actions, queued for passive changes" — right in spirit, but the obvious implementation (inline at every FTP write site) would put a Wahoo round trip inside a profile save, and `retry_request` retries 3× with 1/2/4 s backoff around 30 s timeouts, so a Wahoo outage could hang an unrelated request for the better part of two minutes. The queued path has one hazard — a worker that reads the profile before the request commits sees the *previous* FTP and pushes a stale anchor — and that failure is indistinguishable from a successful no-op, so it would never be noticed. Hence commit-then-enqueue, in that order, with a test asserting the order. |
| **D6** | HR zones are **not** shipped on the assumption they are writable. Phase 3 is gated on the §11 spike; if there is no endpoint, deliver drift display + guidance and say so plainly in the card. | §3.2: no documented endpoint, no scope, `user_write` cannot carry it. Shipping a UI that pretends otherwise would be a lie the user detects on the device. The *payload* is known and simple though — a THR anchor plus boundaries, mirroring power exactly (§3.3) — so if Wahoo exposes it, HR is a small increment, not a redesign. |
| **D7** | Out of scope: syncing weight/height via `user_write`. | It is a separate unused-scope candidate (`wahoo-planned-workout-push.md:49`) and touches Wahoo's own calorie/W-kg maths. Note the interaction, do not bundle it. |

---

## 8. Edge cases / limitations

- **Device sync is not instant.** Wahoo's own guidance is that a plan/workout shows
  on the head unit only within a window (today … +6 days); zone changes are fetched
  by the device on its next sync. Copy must say "on your next sync", not "now".
- **Multiple sets / per-sport profiles.** Indoor vs outdoor cycling can hold
  different sets; `GET` may return more than one BIKING entry. Handle both
  locations, and if we cannot tell which set the head unit uses for a given
  `workout_type_id`, say so in the card rather than guessing.
- **The athlete edits zones in the Wahoo app afterwards.** Our `anchor_value` then
  no longer matches Wahoo's state. Detect by comparing the last read `ftp` to
  `anchor_value`; surface as "changed on Wahoo" (never auto-clobber — prompt).
- **`critical_power` semantics are not a match.** We store Morton CP
  (`models/cycling.py:46`, fitted weekly by Modal); Wahoo's field is described as
  "MMP/Best average power". Send it only if the spike shows it is the same quantity,
  otherwise leave it unset rather than corrupt a field we do not understand.
- **No FTP ⇒ nothing to push.** Card shows the existing "set your FTP" nudge
  (`check_stale_ftp` already sends one).
- **Rate limits / partial failure.** Push rows are independent; a failure on the
  indoor set must not stop the outdoor one. Per-row `last_error`, per-row retry.
- **JSONB round-trip.** Payloads are numbers and strings only, and `boundaries` is
  validated with `json.dumps` before write, so a future non-native value fails at
  record time rather than at flush (pitfall 40).

## 9. Testing

**Pure unit** (`tests/test_wahoo_zones.py`):
- `zone_boundaries_for_ftp`: ladder maths; rescale mode preserves the set's own
  proportions (assert ratios, not just absolute values); integer rounding;
  degenerate input (ftp 0/None, zone_count ≠ boundary count).
- `pick_target_set`: prefers the stored id; picks the lone BIKING set with
  `fitness_app_id > 1000`; refuses a `< 1000` set; returns `None` when ambiguous
  (two candidates) instead of guessing; ignores other families.
- Snapshot rules: `prior` is written once and never overwritten on later pushes;
  revert clears it.

**Service** (stubbed `wahoo_client` — no network in CI):
- opt-in off → zero client calls; FTP unchanged → zero writes; `force=True` →
  writes anyway.
- 403 → `missing_scopes`; 429 → not escalated to the user; other 5xx →
  `last_error` set and **no exception escapes**.
- refresh is not called when the gate fails (assert the call order, not just the
  outcome — the token-cap failure mode is a *silent* one).

**Task** (`auto_estimate_ftp_weekly`): an opted-in Wahoo profile gets a push
enqueued; a *failing* push still leaves the new `profile.ftp_watts` and the
`FtpHistory` row committed.

**Migration**: cross-check model vs migration columns (pattern of the 090 test),
`down_revision = "099"`, and the dialect-type AST walk
(`tests/test_migration_dialect_types.py`) for any `sa.JSONB` slip.

**API/integration**: push endpoint returns the typed 409/403/422; route ordering
asserted by decorator index if a dynamic single-segment route is ever added to the
cycling router.

**Not testable in CI**: anything about Wahoo's actual payload semantics. That is
Phase 0, and its result is *written into §3.1 of this doc*.

## 10. Phasing

| Phase | Deliverable | Exit criteria | State |
|-------|-------------|---------------|-------|
| **0 — spike** | Sandbox verification of §3.1.1–3.1.5 + the §3.2 undocumented-HR probes. Doc updated with observed statuses/payloads. | §3.1 "unverified" list answered or explicitly still unknown with a chosen fallback | **open** — no longer blocks shipping, still decides D2's simplest branch and the validity of the create path |
| **1 — read-only** | `GET /wahoo-zones` + `WahooZonesCard` showing local zones, Wahoo sets, drift. No writes, no toggle. | Card renders real data with `power_zones_read` only | backend **built**; card in progress |
| **2 — power push** | Migration 100, service, client writes, endpoints, toggle, `prior`/revert, task enqueue, notification. | FTP change propagates; revert restores; failures are visible and non-fatal | backend **built** (`23d001c`); card in progress |
| **3 — HR** | Conditional on Phase 0: real HR push if an endpoint exists, else guided-match UI. | Card tells the truth about what is and is not automatable | **not built** — the card states the limitation and shows local HR zones read-only |
| **4 — idle** | Weight/height via `user_write` (D7), additional sports' zone sets. | Explicitly separate | not started |

Phase 1 exists so the card is useful and *verifiable* before anything writes to a
Wahoo account — it also makes the drift visible, which is the feature's whole point.

## 11. Spike checklist (Phase 0)

1. Sandbox app, authorised user, `power_zones_*` scopes → `GET /v1/power_zones`,
   record the raw payload including `zone_count`, `originator_type`,
   `fitness_app_id` for (a) a set created in the Wahoo app and (b) one created via
   the API by our app.
2. `POST` a known ladder (e.g. 100/150/200/250/300/350/400, `zone_count=7`) →
   `GET` it back → determine the `zone_N` convention and the `zone_count` rule.
3. `PUT` **only** `power_zone[ftp]` → `GET` → did the boundaries change?
   (Decides D2's simplest branch.)
4. Does the list include the Wahoo-app's own set? Can we `PUT`/`DELETE` a set whose
   `fitness_app_id < 1000`? (Decides D3; expect 403/404 — record which.)
5. Confirm `PUT /v1/power_zones/{id}` works (docs say `POST`).
6. HR probes: `GET`/`POST` `/v1/heart_rate_zones`, `GET /v1/user` for any HR fields,
   `PUT /v1/user` with `user[heart_rate_zones]` / `user[threshold_heart_rate]`.
   Record status codes verbatim. In parallel, ask Wahoo
   (`partnerships@wahoofitness.com`) whether `heart_rate_zones_*` scopes exist — the
   power-zone endpoint shows their backend already stores anchor-plus-boundaries zone
   sets per family (§3.3), so this is a request, not a hope.
7. Sanity: does the ELEMNT pick up a zone change after a sync, and does it use the
   set assigned to the workout profile the pushed workout targets?

## 12. Files touched

**Backend**
- `backend/alembic/versions/100_add_wahoo_zone_sync.py` (number: re-check first)
- `backend/app/models/wahoo_zones.py` (new) + `backend/app/models/__init__.py`
  (import **and** `__all__`)
- `backend/app/models/cycling.py` (`push_wahoo_zones`)
- `backend/app/schemas/wahoo_zones.py` (new), `backend/app/schemas/cycling.py`
- `backend/app/integrations/wahoo_client.py` (4 methods + constants)
- `backend/app/services/wahoo_zones.py` (new)
- `backend/app/api/cycling/zones.py` (new) + `backend/app/api/cycling/__init__.py`
- `backend/app/tasks/scheduler.py` (`push_wahoo_zones_for_user`; enqueue in
  `auto_estimate_ftp_weekly`)
- `backend/app/services/notifications.py`, `backend/app/models/notification.py`,
  `backend/app/schemas/notification.py`
- Tests: `tests/test_wahoo_zones.py`, task/migration/integration additions

**Frontend**
- `frontend/src/components/cycling/WahooZonesCard.tsx` (new) +
  `frontend/src/app/(app)/cycling/page.tsx`
- `frontend/src/components/cycling/ProfileEditor.tsx` (toggle)
- `frontend/src/lib/api/cycling.ts` (new) + `frontend/src/lib/api/index.ts`
- `frontend/src/lib/api/types/notifications.ts`, `frontend/src/lib/notificationMeta.ts`,
  `frontend/src/components/settings/NotificationSettings.tsx`
- `npm run codegen` after the endpoints land (`frontend/package.json`)

**Docs**
- This file (§3.1 updated with spike results)
- `plans/wahoo-planned-workout-push.md:47-48` — flip `power_zones_read`/`write` to ✅
  (its scope table explicitly asks to be updated when a scope starts being used)
- `AGENTS.md` (Active Planning), `backend/app/services/CODEMAP.md`,
  `backend/app/api/CODEMAP.md`, `frontend/src/CODEMAP.md`
- `docs/algorithms.md` — the zone-model mapping (Coggan 7 vs Wahoo's THR/%FTP sets)
  and the rescale rule

## 13. Open questions

1. **HR zones: is there any writable path?** Answered by spike item 6, not by design.
2. **Which Wahoo zone set does the head unit actually colour against** when the
   active workout was pushed by us (`workout_type_id` 0/12) — the family set, the
   location set, or the set bound to the user's active sport profile?
3. **Rescale default (D2) or FTP-only?** Prefer FTP-only if spike item 3 shows
   server-side recompute; otherwise rescale. Both are cheap; the spike decides.
4. Should the weekly job push at all, or only notify the drift and let the user
   press the button? (Recommendation: push when opted in — that is the feature —
   but make the notification explicit so it is never silent.)
