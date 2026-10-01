# Design Spec — Section 5: Historical Import That Actually Counts

> **Date**: 2026-10-01 · **Type**: bug fix (data integrity) + feature · **Surface**: `/activities` import menu, `POST /activities/import-*`
>
> **Origin**: brainstorm `plans/brainstorm-2026-09-30-open-agenda.md` inventory item
> "no import path for existing data". **Re-baselined: the premise was wrong.** An import
> path exists — `POST /activities/import-gpx` (`activities.py:717`) and
> `POST /activities/import-fit` (`activities.py:825`), with `fit_parser.py` doing real
> per-record stream extraction. The problem is not the absence of import. It is that
> **importing succeeds and the result does not count for anything**.
>
> Plan-mode draft — relocate to repo `plans/` + commit on build mode.

## 1. Problem

### 1.1 Imported rides are invisible to training load

`import_fit` populates `average_power` and `normalized_power` (`activities.py:890-891`)
and never sets `tss`. Every assignment to `activity.tss` in the codebase lives inside a
provider sync:

| Site | Path |
|---|---|
| `services/strava/sync.py:437` | Strava sync |
| `services/wahoo.py:367` | Wahoo sync |
| `services/strava/webhooks.py:182` | Strava webhook |
| `services/cycling/tss.py:165,172` | inside `auto_compute_tss_for_activity`, called only by the above |
| `tasks/scheduler.py:3568` | `backfill_lifting_tss` — **lifting only** |

There is no non-lifting TSS backfill task. And consumers skip null-`tss` activities
explicitly — `services/analytics.py:217` (`if a.tss is None or a.start_date is None: continue`).

So an imported FIT ride is excluded from weekly TSS, `get_daily_tss`, CTL/ATL, TSS trend
charts, training load, **and every one of the recommendation engines that Section 1 unifies**.
The file is parsed correctly, the streams are stored, and the ride is then treated as if
it did not happen.

This is the defect that matters. The single-user premise makes it worse, not better: for
one person, the historical record *is* the app. Five years of backfilled training that
silently contributes nothing to load is worse than no import at all, because the dashboard
looks complete while being wrong.

### 1.2 Re-importing the same file creates a duplicate

`import_fit` constructs `Activity(user_id=…, source="manual", …)` (`activities.py:879-898`)
with **no `provider_activity_id`** and no `connection_id`. There is no content hash, no
fuzzy key, nothing to deduplicate on. Uploading the same file twice yields two `Activity`
rows, and every load-bearing aggregate then counts that ride twice.

Fatal for any bulk workflow, and §1.3 makes bulk the obvious next step.

### 1.3 The FIT time axis is thrown away, then re-derived arithmetically

`fit_parser.py:164-182` iterates every `record` message and extracts eight fields —
`heart_rate`, `power`, `cadence`, `altitude`, `enhanced_speed`, `position_lat/long`,
`temperature`. It **never reads `timestamp`**, which the FIT format guarantees per record
and which is the only authoritative time axis in the file.

Downstream, `services/segments.py:280-306 _time_axis` was written specifically to fix a
related problem, and its docstring says so:

> *Strava reports a per-stream `resolution` as the string `"high"` or `"low"`, which the
> stream importer can't turn into a number — so `ActivityStream.resolution` is `NULL` and
> every consumer falls back to "1 second per sample". That's wrong for the low-resolution
> streams… The `time` stream is always high-resolution, so indexing into it gives the real
> per-sample spacing.*

That machinery **works and is unreachable for FIT imports**, for two independent reasons:

1. `fit_parser.py` never emits a `time` stream, so `_time_axis` finds nothing.
2. `STREAM_TYPE_MAP` (`activities.py:903-912`) maps no `time` key either, so even a parsed
   timestamp stream would not be persisted.

Falling back to nominal resolution lands on `activities.py:917`:

```python
res = max(1, dur // len(values)) if dur else None
```

Integer floor division over a session duration — so every stream gets **one uniform
spacing**, and a multi-rate FIT file (1 Hz power alongside 5 s GPS) is forced onto a single
axis. Consequence for Section 3: `SegmentEffort` windows computed from imported rides use
the nominal resolution, so every segment effort and VAM on an imported route is
systematically wrong. This is the direct coupling to §Section 3's climb leaderboard —
a hill you import and then race is ranked on fabricated effort data.

### 1.4 Single file, no progress, no partial-failure recovery

`UploadFile = File(...)` — one activity per request. The frontend call site
(`activities/page.tsx:465-478`) is a single `<input type="file">` with no `multiple`
attribute and no batch state. Importing five years of history is 2 000 sequential requests
with no progress indication.

Worse, `get_db` commits at the end of the request. Any naive bulk loop inherits
**all-or-nothing semantics**: file 1 900 succeeds, file 1 901 throws, and the whole batch
rolls back with no record of what happened. See §3.1 — this is the trap that makes naive
bulk import worse than no bulk import.

### 1.5 Imported rides never join routes

Imported activities get `route_id=None`. `POST /activities/backfill-route-links`
(`activities.py:532`) exists but is a manual call. So an imported ride contributes nothing
to route matching, climb detection, or segment efforts until someone remembers to invoke it
— and §1.3 means that invocation would still produce wrong effort numbers.

## 2. Design

### 2.1 Compute TSS at import

Call `auto_compute_tss_for_activity` (`services/cycling/tss.py:145`) from `import_fit`
after `db.flush()`, so the stored power stream is queryable. Prefer the FIT-supplied
`normalized_power` over recomputing it from samples — the device's NP is more accurate than
a 30 s rolling-window recomputation, and it is already parsed
(`fit_parser.py:141-144`). Set `tss_source` via the existing
`TSS_SOURCE_POWER` / `TSS_SOURCE_HR` constants rather than a literal.

Falls back to HR TSS when no FTP is configured — already handled inside that function, so
nothing new is needed. Imported activities therefore become visible to
`get_daily_tss`, CTL/ATL, and Section 1's engines with no further wiring.

### 2.2 Deduplicate in two tiers

Neither tier alone is sufficient, so both are needed:

- **Exact** — `sha256` of the file bytes. Catches re-uploading the same export. Stored on
  `Activity.import_fingerprint` (new nullable `String`, partial unique index on
  `(user_id, import_fingerprint)` where non-null). Exact-duplicate upload returns the
  existing activity rather than creating a second row.
- **Fuzzy** — same `sport_type`, `start_date` within ±5 min, `duration_seconds` within 1%,
  `distance_meters` within 1%. Catches the same ride re-exported by different software, or
  downloaded from Strava in addition to imported from the head unit. This mirrors the
  merge-threshold approach already in `merge_service` and
  `POST /activities/merge-analysis` (`activities.py:589`), so the thresholds are not invented
  from nothing.

Fuzzy match → attach an `ActivitySource` row (`provider="import"`, the FIT's own
`file_id`/serial as `provider_activity_id`) rather than discarding, so provenance is
preserved and the merge is reversible. This is the same shape as the Wahoo/Strava merge,
and it composes with `pitfall 21`'s provenance rule.

### 2.3 Bulk import with per-file commit

`POST /activities/import-bulk`, multipart with N files. Returns a per-file result array
(`{filename, status: created|duplicate|failed, activity_id?, error?}`) — **not** a
single success/failure. Each file commits independently via `await db.commit()` inside the
loop so a mid-batch failure cannot discard earlier successes (§3.1).

Given the single-user premise, synchronous is correct here — no Celery job, no progress
polling. Bound the batch (20 files) and rely on the 50 MB per-file cap already in place
(`BUG-017`). Frontend: `<input multiple>`, list the selected files, show a per-file result
list on completion.

Route ordering: register `/import-bulk` **above** the `/{activity_id}/…` handlers
(`activities.py:944+`). Static-before-dynamic, per pitfall 13.

### 2.4 Carry the FIT time axis end to end

- `fit_parser.py`: extract the per-record `timestamp` into a `time` stream, parallel to the
  eight existing fields. **Verify the decoded type first** — `fitdecode` special-cases
  FIT's timestamp field type and may hand back `datetime` rather than a raw integer, in
  which case it needs converting to epoch seconds. Do not guess; assert it in a test against
  a real file.
- `activities.py STREAM_TYPE_MAP`: add `"timestamp": "time"`.
- Set `resolution=1` for the `time` stream specifically — it is the axis the others are
  resampled onto, so it must not inherit the `dur // len(values)` arithmetic.
- Now populate `ActivityStream.resolution` from the **real observed spacing**
  (`median(diff(time))`) instead of the arithmetic guess, for every stream. That removes
  the `or 1` fallback path entirely rather than leaving two competing sources of truth.

This makes `_time_axis` and `_resample_onto_axis` (`segments.py:280-330`) actually engage
for imported rides, which is what they were written for.

### 2.5 Auto-link routes after import

After a successful import, schedule `backfill-route-links` for the affected activity ids
rather than requiring a manual POST. Gate it on `route_id is None` and reuse the existing
matching service — this is where §1.3 stops mattering, because effort windows are now on a
real time axis.

### 2.6 Backfill TSS for already-imported activities

Existing imports are stranded with `tss=None`. A one-shot migration/task backfills them
through `auto_compute_tss_for_activity`, restricted to `source="manual"` **and**
`tss IS NULL`. Skips anything already handled. Should be idempotent and re-runnable.

## 3. Traps

### 3.1 Per-file commit or nothing

`get_db` owns the transaction. A bulk loop without an inner `db.commit()` is atomic across
the batch, so one malformed file erases the whole import. **Per-file commit inside the
loop is mandatory**, not an optimisation. Each commit must also be individually
error-handled so one failure does not poison the session for the files after it.

### 3.2 The new unique index must be partial

`import_fingerprint` is nullable and must stay nullable for every provider-synced activity.
A plain `unique(user_id, import_fingerprint)` would collide across the thousands of rows
that are `NULL`. Use `postgresql_where=sa.text("import_fingerprint IS NOT NULL")`.

Precedent: pitfall 21 and migration 087 — do not repurpose a mutable column for provenance,
and key on provider identity rather than a value that later syncs will change.

### 3.3 Verify the FIT timestamp type, do not assume

FIT timestamps are conceptually "milliseconds since the FIT epoch (1989-12-31)", but
`fitdecode` applies its own conversion and may deliver `datetime`. A naive `int(...)` on a
`datetime` raises `TypeError` at import time — i.e. exactly when someone uploads their
first historic file. Pin this with a parser test against a real FIT sample.

### 3.4 `time` stream must not be re-widened

`_time_axis` requires a **strictly increasing** series and returns `None` otherwise
(`segments.py:302-303`). A file with duplicate or out-of-order timestamps silently loses its
axis and falls back to nominal resolution — the exact bug being fixed. Validate
monotonicity at parse time and reject or drop rather than storing a bad axis.

### 3.5 Idempotent migration only

`2.6`'s backfill runs over rows that may already have TSS. Restrict to `tss IS NULL` and
make re-running a no-op, or a scheduler re-run will recompute and churn every manual
activity.

## 4. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Fuzzy dedup merges two genuinely distinct rides (same ride, different day-type) | Thresholds are ±5 min / 1% — tight enough that a false positive requires a near-coincident same-sport session. Response is an `ActivitySource` attach, not a destructive merge, so it is reversible |
| Per-file commits leave partial imports on failure | That is the intent — the per-file result array reports exactly what landed. Add a "retry failed only" affordance |
| Storing a full-resolution `time` stream inflates row size | FIT is already 1 Hz; ~3 600 floats/ride. Compare against existing `power`/`heartrate` streams — this is the same order of magnitude |
| Bulk endpoint blocks the worker | Bounded at 20 files × 50 MB. Single user. Async job machinery would be premature |
| GPX import path not covered by §2.2/§2.4 | GPX has no power streams and no FIT timestamps; dedup by exact hash still applies, time-axis work does not. Scope §2.4 FIT-only and say so |

## 5. Testing

- **TSS on import**: a FIT with power and an FTP configured yields `tss` set and
  `tss_source == "power"`; without FTP it falls back to HR TSS. Assert the activity now
  appears in `get_daily_tss` for its date — the property that motivated §2.1.
- **Exact dedup**: uploading identical bytes twice returns the same `activity_id` and
  leaves one row.
- **Fuzzy dedup**: a ride re-exported with a different byte layout but matching
  sport/time/duration/distance attaches an `ActivitySource` rather than creating a row.
- **Null-fingerprint coexistence**: several provider-synced activities with
  `import_fingerprint IS NULL` coexist without a unique violation — guards §3.2.
- **Per-file isolation**: a 3-file batch where the middle file is corrupt yields two
  created activities and one `failed` entry, and **both successes survive the request** —
  the regression test for §3.1.
- **Time axis**: parsed FIT produces a strictly increasing `time` stream, `resolution=1`,
  and `_time_axis` on the stored streams returns non-`None`. Pin the decoded timestamp type
  (§3.3).
- **Observed spacing**: a multi-rate file yields a `resolution` matching the real median
  sample interval, not `dur // len(values)`.
- **Route linking**: importing a ride that matches a known route sets `route_id` without a
  manual POST.

## 6. Defers (explicit)

- **CSV import** (Garmin Connect / Wahoo / TrainingPeaks bulk exports). The FIT path is the
  high-fidelity one and the same dedup/TSS service layer makes CSV a later add. Worth it,
  but a separate spec — it needs a column-mapping UI.
- **Async import jobs with progress polling.** Premature for a single user with a bounded
  batch; revisit if bulk grows to hundreds of files.
- **Activity editing after import** (fix a wrong sport type or name). Real gap, orthogonal to
  import mechanics.
- **Undo.** Named in the brainstorm inventory and still undefinable without knowing what a
  correct restore looks like. Deferring again, deliberately — it is a design problem, not
  an implementation one.

## 7. AGENTS pitfalls honored

- **13** — `/import-bulk` registered above the `/{activity_id}` handlers; the test asserts
  decorator **index order**, not handler existence.
- **21** — provenance via `ActivitySource(provider="import")`, never a repurposed mutable
  field. `import_fingerprint` is derived from content, not mutated by later syncs.
- **22** — additive nullable `String` column plus a partial index. No `JSONB`, so the
  dialect trap does not apply; `postgresql_where` is spelled with a `sa.text(...)` import.
- **23** — all tests run host-side from `backend/` with `python -m pytest tests/ -q`.
- **Async everywhere** — `auto_compute_tss_for_activity` is `async`; called with `await`.