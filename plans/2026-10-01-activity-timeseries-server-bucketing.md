# Design Spec — Section 4: Server-Side Activity Time Series (kill the fabricated zero)

> **Date**: 2026-10-01 · **Type**: bug fix (data integrity) + feature · **Surface**: `/activities` (stats & patterns views)
> **Origin**: brainstorm `plans/brainstorm-2026-09-30-open-agenda.md` item T2 #4, framed as
> "the 200-activity ceiling". Re-baselined against the code: the ceiling is real but it is
> a **symptom**. The defect is that the activities page buckets client-side over a truncated
> row set and **zero-fills the gaps**, so truncation renders as a training dip that never
> happened. Scope: **S2** (`GET /activities/timeseries`) + **S3** (dashboard consolidation,
> §6) — both chosen.
>
> Plan-mode draft — relocate to repo `plans/` + commit on build mode.

## 1. Problem

`StatsView` pre-creates every chart slot with a zero, then fills from the rows that came back:

```tsx
// StatsView.tsx:31-42 — six month slots, hardcoded
for (let i = 5; i >= 0; i--) { months.push({ key, label, distance: 0 }); }
for (const a of activities) {
  const month = months.find((m) => m.key === key);
  if (month) month.distance += a.distance_meters ?? 0;   // ← no slot → silently dropped
}
```

Identical shape for the 12-week TSS chart (`StatsView.tsx:75-88`). The source is:

```ts
// page.tsx:731
/api/v1/activities?start_date_after=${sixMonthsAgo}&limit=${STATS_WINDOW_LIMIT}&sort_by=start_date&sort_order=desc
```

### 1.1 Truncation renders as fabricated rest

Past 200 activities in six months the oldest weeks and months receive **no rows**, keep
their pre-seeded `0`, and draw as a taper. The inline note immediately above the chart
asserts the opposite:

> *"older months and weeks would be understated — **this view does not silently chart a
> partial window**"* (`page.tsx:1068-1070`)

It does exactly that. `statsWindowTruncated` (`page.tsx:740`) only decides whether to
*display* the note; nothing suppresses the zero-fill. The corrupted series is **TSS** — the
load figure an athlete uses to decide whether to add volume. A phantom taper reads as a
deliberate one.

200 activities in six months is ~3/week. A powerlifter who also cycles clears that easily,
so this is the expected state for this user, not an edge case.

### 1.2 The cost of the current approach

`list_activities` eagerly hydrates every row (`activities.py:213-220`):

```python
selectinload(Activity.lifting_session).selectinload(LiftingSession.sets),
selectinload(Activity.sources),
selectinload(Activity.route),
selectinload(Activity.streams).load_only(ActivityStream.id),
```

So the stats view downloads **200 fully-hydrated activities** — every lifting set, every
provider source, the linked route, and one stream-id row per stream — to compute eighteen
bar values. The aggregate needs six scalar columns.

### 1.3 The correct pattern already exists in this codebase

`services/charts.py:125` — `ChartService.weekly_tss` aggregates in SQL with
`func.date_trunc("week", Activity.start_date)` + `group_by` + `sum`, over **all** matching
rows with no row cap. `date_trunc` is already used in ~15 places (`charts.py:127,216,1493`,
`dashboard/weekly.py:297`, `dashboard/yearly.py:220`, `services/lifting.py:980`,
`services/cycling/tss.py:136`, `services/llm_analysis.py:124`). The activities page is the
one surface that never adopted it.

This is why the fix is structural rather than cosmetic: **with the aggregation in SQL there
is no row cap anywhere in the path, so a truncated time series stops being representable.**
`STATS_WINDOW_LIMIT`, `statsActivities`, `statsWindowTruncated`, and the false note all get
**deleted** — not patched.

### 1.4 Found while verifying S3: `worst_recovery_day` cannot report a zero

`dashboard/weekly.py:226`:

```python
worst_day = min(current_week, key=lambda m: m.recovery_score or 200)
```

`recovery_score or 200` treats a legitimate **0** as falsy and scores it 200, so a genuinely
worst day is structurally unable to be selected as the worst. Line 223's `best_day` uses
`or 0`, so the two disagree in opposite directions.

This is the codebase's own discipline violated: `_mean(..., zero_is_dropout=True)`
(`services/segments.py:482-495`) exists precisely because "0 means something different per
signal", and `segment_intelligence.py:230-232` guards `None` explicitly. Fix is to compare
on the real value with an explicit `None` guard rather than truthiness. Not part of the
time-series work, but found during it and one line wide — it rides along.

## 2. Design

### 2.1 Service — `ChartService.activity_timeseries`

```python
async def activity_timeseries(
    self,
    user_id: uuid.UUID,
    *,
    bucket: Literal["day", "week", "month"],
    start: date,
    end: date,
    sport_type: str | None = None,
    source: str | None = None,
) -> dict
```

Mirrors `weekly_tss`'s shape (pitfall: reuse the proven pattern, don't invent a second one):

```python
bucket_expr = func.date_trunc(bucket, Activity.start_date).label("bucket_start")
rows = await self.db.execute(
    select(
        bucket_expr,
        func.count(Activity.id).label("count"),
        func.coalesce(func.sum(Activity.distance_meters), 0).label("distance_meters"),
        func.coalesce(func.sum(Activity.duration_seconds), 0).label("duration_seconds"),
        func.coalesce(func.sum(Activity.elevation_gain_meters), 0).label("elevation_gain_meters"),
        func.coalesce(func.sum(Activity.tss), 0).label("tss"),
    )
    .where(*base_filters)          # user_id, source != "wahoo", optional sport/source
    .group_by(bucket_expr)
    .order_by(bucket_expr)
)
```

Plus one second grouped query for the sport-breakdown pie
(`group_by(Activity.sport_type)` over the same filters). Two aggregate queries total.

Postgres `date_trunc('week', …)` is **Monday-based**, matching the `getISOWeek` helper
already in `StatsView.tsx:10-16`, so bucket boundaries do not shift.

### 2.2 Dense buckets + `complete` — the integrity invariant

`group_by` returns **only buckets that have rows**, so a rest week is simply absent. If the
client re-zero-fills, we are back to the original bug. Therefore the service emits a
**dense** series: every bucket in `[start, end]` is present, zero-filled.

```python
class TimeseriesBucket(BaseModel):
    bucket_start: date
    count: int = 0
    distance_meters: float = 0
    duration_seconds: int = 0
    elevation_gain_meters: float = 0
    tss: float = 0

class TimeseriesResponse(BaseModel):
    bucket: Literal["day", "week", "month"]
    start: date
    end: date
    complete: bool = True          # False only if the range was clamped server-side
    clamped_to: date | None = None # the effective end, when clamped
    buckets: list[TimeseriesBucket]        # dense, ascending
    totals: TimeseriesTotals              # over the whole range, untruncated
    sport_breakdown: list[SportCount]      # [{sport_type, count}]
```

Two consequences, and both matter:

- A `0` bucket now means **"no training"**, which is true by construction. The client has no
  code path that can invent one.
- `complete` is belt-and-braces. With server-side aggregation truncation cannot happen, so
  it stays `True` — but it exists so that if a future max-span clamp is ever added, the UI
  has an honest signal to surface instead of guessing client-side. This is the invariant the
  deleted note was *trying* to provide, made structural.

Range guards: `bucket=day` capped at 366 buckets, `week` at 520, `month` at 240. Exceeding
clamps `end` and sets `complete=False` with `clamped_to`.

### 2.3 Endpoint

`GET /activities/timeseries?bucket=&start=&end=&sport_type=&source=`

- ⚠️ **Pitfall 13**: static route — **must be registered above `/{activity_id}`** in
  `api/activities.py`. `/summary` (line 239) and `/calendar` (line 335) both sit above the
  dynamic route; this would be the third instance of this trap in this codebase. The test
  asserts decorator **order**, not handler existence — the lesson from the `/orphans`
  422 incident, where "the handler is defined" proved nothing.
- Reuses the same filter semantics as `list_activities`, including the
  `Activity.source != "wahoo"` filter (see §3.2).

### 2.4 Frontend

**`StatsView`** stops accepting `activities: Activity[]` and instead takes the server
response. All three charts derive from it:

- Monthly distance → `bucket=month`
- Weekly TSS → `bucket=week`
- Sport breakdown → `sport_breakdown`

**The zero-fill code is deleted outright** — lines 31-42 and 75-88 in `StatsView.tsx`. There
is no longer any client-side bucket construction, so the defect cannot be reintroduced by
editing a loop.

**Horizons become real controls.** The hardcoded `i = 5..0` and `i = 11..0` literals are
replaced by a range selector (6 months / 12 months / 24 months / all) driving `start`/`end`.
This is the actual feature unlock the ceiling was masking: the horizon becomes a user choice
at any depth, not a constant someone picked.

**`PatternsView`** uses `sport_breakdown` + `totals` for its preset counts. Its *filtered
activity list* genuinely needs rows, so it keeps a paged fetch — but the numbers shown
alongside come from the aggregate, so they no longer disagree with the charts.

**Deleted outright:** `STATS_WINDOW_LIMIT` (`page.tsx:77`), the `statsActivities` query
(729-737), `statsWindowTruncated` (740), and the false note (1065-1072).

Labels: the API returns raw `bucket_start` dates and the component formats them with
`getActiveLocale()` — preserving i18n, and matching how `ChartService.weekly_tss` already
labels by `week_start`. Note this **changes the week labels** from `W07` to a date
(`weekly_tss` already labels `strftime("%Y-%m-%d")`); that is a deliberate consistency fix,
not a regression.

## 3. Traps this spec exists to prevent

### 3.1 Do not copy `tss.isnot(None)` into the combined aggregate

`ChartService.weekly_tss` filters `Activity.tss.isnot(None)` (`charts.py:135`). That is
correct for a **TSS-only** chart. Copying it into a combined count+distance+duration+tss
aggregate would **drop every un-TSS'd activity from all four metrics** — silently
under-counting lifting sessions and rides with no TSS. Use `coalesce(sum(...), 0)` and
filter nothing but ownership/scope.

### 3.2 Do not forget `source != "wahoo"`

Every activity query in this codebase excludes standalone Wahoo rows because they were
merged into their Strava twin (`activities.py:174-176`, and pitfall 21 — purges must key on
`EXISTS (activity_sources WHERE provider='wahoo')` provenance, not the mutable `source`
field). A new aggregate that omits the filter would double-count merged activities and
disagree with every other view on the page.

### 3.3 Zero-filling belongs on the server only

If the client ever needs to fill a gap, that is a bug in the dense-bucket guarantee, not a
missing loop. A regression test asserts the API returns a bucket for **every** date in
range, including rest days.

## 4. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `date_trunc` on a timestamp vs the client's local-time bucketing | Postgres `date_trunc` is UTC; activity `start_date` is timezone-aware. The existing `weekly_tss` already buckets this way and the dashboard charts are correct today, so the semantics are already established. Bucket boundaries are day-level, so a few hours of drift cannot move a bucket — but week boundaries are Monday-anchored, which §2.1 confirms matches `getISOWeek`. |
| Dense buckets for a 24-month daily range = 730 rows | Bounded by the §2.2 guards; 730 small objects is far cheaper than 200 hydrated activity rows. |
| Endpoint ordering mistake → 422 | Pitfall 13; order-asserting test. |
| Deleting the warning note loses a real signal | The signal is replaced by `complete` from the API, which is authoritative. The client-side guess it replaces was the thing that was wrong. |
| Label change `W07` → date reads as a regression | Matches `weekly_tss` and the rest of the dashboard; called out in §2.4 as intentional. |

## 5. Testing (host-side — pitfall 23)

`backend/tests/test_activity_timeseries.py` (new):
- **Dense**: a 14-day range with 3 active days returns **14** buckets; the 11 empty days are
  present with `count=0`, `tss=0`. ← the regression gate for the whole section.
- **`tss`-null activities still count** (trap §3.1): an activity with `tss=None` contributes
  to `count` and `distance_meters` and contributes 0 to `tss`.
- **No double-count** (trap §3.2): a Wahoo-sourced activity is excluded, matching
  `list_activities`.
- `bucket=week` yields Monday-anchored buckets; `bucket=month` yields first-of-month.
- Guard clamping: `bucket=day` over 5 years clamps `end`, sets `complete=False`, populates
  `clamped_to`.
- `totals` equal the sum of `buckets` (guards against a totals/buckets divergence).
- Empty range → all-zero dense buckets, not `[]`.
- Route-ordering test: `/timeseries` registered **before** `/{activity_id}`.

Frontend:
- `StatsView` renders dense buckets with no client-side zero-fill; a rest week renders as a
  visible 0, and no code path fabricates one.
- The deleted note does not appear, and `complete === false` **does** surface a warning.

### S2 + S3 gates

- **Cross-consistency** (the point of §6.1): for the same user and month range,
  `GET /activities/timeseries?bucket=month` and `monthly_breakdown` return **identical**
  activity counts, TSS, distance and duration. This is the test that makes the consolidation
  load-bearing rather than cosmetic — if the two ever disagree, one of them has drifted.
- **`monthly_breakdown` dense-fill**: a month with no activity, no lifting and no PRs is
  present with zeros, matching the current `weekly.py:383-388` / `yearly.py:309-314`
  behaviour. Snapshot the existing response shape before the refactor so the dashboard's
  payload is provably unchanged.
- **Wahoo guard present**: a Wahoo-sourced activity is absent from `monthly_breakdown`
  *and* from `activity_timeseries` — asserted through the shared primitive, so the filter
  cannot be dropped from one copy without failing the test.
- **`worst_recovery_day` zero** (§1.4): a week containing a day with
  `recovery_score == 0` reports that day as `worst_recovery_day`, and the `None`-valued
  day is still excluded from the comparison. Guards the truthiness fix from both sides.

## 6. S3 — Dashboard consolidation

**Scope chosen, but the framing is not what I first wrote.** I deferred this claiming the
dashboard charts "are correct today". I then read them to check, and that claim holds:
`weekly.py:monthly-summary` (285-331) and `yearly.py:207-307` both aggregate in SQL via
`func.to_char(…, "YYYY-MM")` + `group_by`, and both **dense-fill** the month list
(`weekly.py:383-388`, `yearly.py:309-314`). `weekly.py:502-544` likewise. There is no
fabricated-zero defect on the dashboard.

So S3 is **consolidation, not a fix** — but the duplication is a real latent risk, not
tidiness:

| Block | Copies | Locations |
|---|---|---|
| activity-by-month (5 metrics) | 3 | `weekly.py:308`, `yearly.py:231`, `weekly.py:517` (count only) |
| lifting-by-month (sessions + volume) | 2 | `weekly.py:285`, `yearly.py:207` |
| PRs-by-month | 4 | `weekly.py:334`, `weekly.py:350`, `yearly.py:257`, `yearly.py:275` |

Nine hand-written grouped queries across two files. The `Activity.source != "wahoo"` guard
is hand-copied into three of them — and that is precisely the filter §3.2 warns about
dropping, because omitting it double-counts Wahoo-merged activities. **Nothing enforces its
presence across the copies.** The duplication is the correctness risk; consolidating it is
the mitigation.

### 6.1 Shape correction — a service function, not an HTTP endpoint

Routing the dashboard through `GET /activities/timeseries` would be the wrong shape: the
dashboard needs lifting volume, PRs and recovery *alongside* activity, which is a
multi-table breakdown, not an activity series. Forcing it through the activities-page
endpoint would either widen that contract or push mapping logic into the route.

The shared unit is a **service function** in `services/charts.py`:

```python
async def monthly_breakdown(
    db, user_id, *, start: date, end: date
) -> list[MonthlyBreakdownItem]:
    """Dense per-month breakdown: activity, lifting, PRs, avg recovery.

    One place where the Activity.source != "wahoo" guard is written, and one
    place that knows how to zero-fill a month that has no rows.
    """
```

- `monthly_breakdown` owns the dense-fill logic and the Wahoo guard, so neither can drift.
- `weekly.py:monthly-summary` and `yearly.py`'s monthly breakdown both call it.
  `weekly.py:517` uses a narrower variant (activity count only) — either a `metrics`
  parameter or a small sibling; prefer the parameter to avoid a second code path.
- `ChartService.activity_timeseries` (§2.1) **delegates its activity bucketing to the same
  primitive**, so the activities page and the dashboard cannot disagree about what a month
  contains. This is the property that makes the consolidation worth doing rather than
  merely tidier.

### 6.2 Sequencing

S3 lands **after** S2 and reuses its dense-bucket guarantee. Order matters: extracting
`monthly_breakdown` first would mean writing the dense-fill contract twice.

## 7. Defers (explicit)
- **Cross-domain series** (sleep vs TSS on one axis). Wants `DailyMetric` bucketing in the
  same response — a natural follow-on once the endpoint is proven, but it widens the contract.
- **Moving the `/activities` list view onto keyset pagination.** The list already paginates
  correctly (`X-Total-Count` + Load More); no defect here.
- **Caching.** Aggregate queries over indexed `(user_id, start_date)` are cheap enough that
  a cache layer would be premature.
- **Unifying `charts.py`'s own `date_trunc` weekly/monthly methods** onto `monthly_breakdown`.
  Same reasoning as S3 but a wider diff; only worth it once S3 has settled the contract.

## 8. AGENTS pitfalls honored
- **13** — `/activities/timeseries` registered above `/{activity_id}`; order-asserting test.
  Third occurrence of this trap in the codebase, so the test asserts index order.
- **21** — the `source != "wahoo"` filter is deliberate and tested, matching the provenance
  lesson from migration 085/087.
- **22/24** — no migration in this section; no schema change at all.
- **23** — backend tests run host-side from `backend/`, never via `fittrack.py exec backend`.
- **11** — `enabled: !!token` preserved on the new query key `['activity-timeseries', …]`.
- **Truthiness discipline** — §1.4's `or 200` fix follows the precedent already set by
  `_mean(..., zero_is_dropout=True)` (`services/segments.py:482`) and the explicit
  `is not None` guards in `segment_intelligence.py:230`: a `0` that means something must
  never be swallowed by a truthiness test.