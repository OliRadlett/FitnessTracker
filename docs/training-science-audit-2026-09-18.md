# FitTrack Training-Science Audit — 2026-09-18

> **Implementation status (2026-09-18):** all PROVEN-wrong findings below were
> implemented (uncommitted working tree): illness `/0.80` fix, overtraining
> 180-day lookback, volume-EWMA order, zero-preserving NP/power-curve,
> `CTL_WARMUP_DAYS=210` warm-up + widened TSS fetch windows, FTP tier gating
> + 5-min ×0.85, LTHR zone table, big-3 advice direction, push/pull one-sided
> + wording + bodyweight sets, calorie ×3.6, plus the minor items (decoupling
> ratio-of-means, resolution-aware windows, unridden power exclusion, historic
> VO2max weights, RPE rounding, quadratic hrTSS). Deliberately NOT changed:
> CTL `/42` vs `1−e^(−1/τ)` divergence, sex-specific strength norms, climb
> categories, W/kg table, `tasks/scheduler.py` (owned by another session —
> its `get_daily_tss` fetch at `scheduler.py:1562` still lacks the warm-up
> window). `docs/algorithms.md` + CODEMAP sync left to the owning session.
>
> **Scope:** physiological + mathematical correctness of the training-science layer.
> `backend/app/services/cycling/{tss,training_load,power_curve,vo2max,zones,power_profile}.py`,
> `workout_planner.py`, `deficiency.py`, `projections.py`, `adaptive.py`,
> `segments.py`, `health_analysis.py`.
> Read-only audit — all fixes are proposals only, no code changed.
> **PROVEN** = traced in code; **SUSPECTED** = needs runtime data to confirm.
> Index cross-checked against `docs/algorithms.md` and `backend/app/services/CODEMAP.md`.

---

## Top 5 safety-critical issues

### 1. Illness composite is multiplied by 100 in the RR-missing branch — every nonzero signal becomes a *critical* illness alert

**Evidence:** `backend/app/services/health_analysis.py:648-662`

```python
has_rr_data = current_rr is not None and baseline_rr is not None
if has_rr_data:
    score = recovery*0.25 + rr*0.20 + hrv*0.25 + sleep*0.15 + fatigue*0.15   # 0–100 ✓
else:
    raw_total = recovery*0.25 + hrv*0.25 + sleep*0.15 + fatigue*0.15         # max = 80
    score = raw_total / 0.80 * 100                                           # ← ×100 bug
```

Each signal is already on a 0–100 scale and the weights sum to 0.80, so the correct
renormalisation is `raw_total / 0.80` (max 100). The extra `* 100` makes the score
100× too large. With RR missing (no `respiratory_rate` on the recent `DailyMetric`s,
`health_analysis.py:598-599`), the minimum nonzero weighted signal is `40 × 0.15 = 6`,
giving `score = 750` → `_classify_severity` (`:269-277`) returns **critical** for
*any* flag. This is live via `api/metrics.py:583` and `tasks/scheduler.py:582`, and
`upsert_alert` (`:719-777`) creates a critical alert + notification.

**Concrete failing example:** 3 recent `DailyMetric` rows (passes the `len(metrics) >= 3`
gate at `:574`), latest `recovery_score = 30` (→ `_recovery_illness_signal = 40`),
stable HRV, good sleep, no RR data. `raw_total = 10`, `score = 10/0.8×100 = 1250`,
severity `critical`: "Multiple illness signals detected — rest and monitor symptoms
closely." A single mild recovery dip is amplified into a critical illness alert.

**Minimal fix:** `score = raw_total / 0.80` (delete `* 100`).
**Regression sketch:** stub RR absent, one signal at 40, all others 0 →
assert `analyze_illness(...)["score"] == pytest.approx(12.5)` and
`severity == "info"`; assert all-zero signals → `0.0`/`"none"`.

---

### 2. Overtraining TSB is computed with a 7-day EWMA warm-up, saturating the composite for normal training weeks

**Evidence:** `health_analysis.py:326-329`

```python
start_date = end_date - timedelta(days=49)
daily_tss = await get_daily_tss(db, user_id, start_date, end_date)
load_data = compute_training_load(daily_tss, end_date, lookback_days=7)   # ← τ=42 warm-up truncated
tsb_values = [d["tsb"] for d in load_data[-7:]]
```

`compute_training_load` always seeds `ctl = atl = 0` at `end_date − lookback_days`
(`training_load.py:35-43`). With `lookback_days=7` the CTL (τ=42) starts from 0 and has
only 7 days to converge, while ATL (τ=7) is near-converged, so TSB is systematically
driven very negative. Every other caller uses `lookback_days=90` (e.g.
`adaptive.py:483`, `projections.py:674`, `api/dashboard/today.py:53`); this one call
is the outlier.

**Concrete failing example (PROVEN arithmetic):** constant 100 TSS/day. Per-day TSB
from this call: −10.9, −20.2, −28.0, −34.6, −39.9, −44.3, −47.9. Days 5–7 are `< −35`,
so `_tsb_signal` (`:40-50`) returns **70** instead of 0. The threshold is crossed for
any athlete averaging ≥ ~73 TSS/day over the week; at ≥ ~125 TSS/day it returns 100.
The composite at `:352` is `70×0.40 = 28` alone; combined with a modest recovery
signal (40 → +14) and a mild HRV dip (40 → +6) it reaches warning, and one more
signal tips critical. In other words the overtraining composite has a 28–40 point
false floor for consistent trainers.

**Minimal fix:** fetch ≥180 days of TSS and
`compute_training_load(daily_tss, end_date, lookback_days=180)` (≥4τ for CTL),
then slice `[-7:]`.
**Regression sketch:** 180 days at 100 TSS/day → last-7 `_tsb_signal` must be `0.0`;
assert `|TSB| < 5`.

---

### 3. Volume-spike EWMA weights the *oldest* prior week most heavily

**Evidence:** `health_analysis.py:162-174`; caller `:457-466`

```python
active_volumes = [vol for vol, active in zip(prior_week_volumes, prior_week_active) if active]
...
ewma = active_volumes[0]                 # = bucket-1 = MOST RECENT prior week
for vol in active_volumes[1:]:           # comment says "oldest first" — it is not
    ewma = alpha * vol + (1 - alpha) * ewma
```

`week_volumes[0]` is the current bucket; `prior_week_vols = week_volumes[1:]` is
ordered **newest → oldest** (`:459-466`). The loop therefore gives α weight to the
oldest available week and the seed weight to the newest — the exact inverse of
"EWMA with 4-week half-life". The unit tests (`tests/test_health_analysis.py:79-116`)
only use constant prior volumes, so the ordering is untested.

**Concrete failing example (PROVEN arithmetic):** prior weeks newest→oldest
`[200,150,100,100,100]` kg (a real ramp), current week `180` kg. Code baseline
`ewma = 142.1` → `increase = +26.7%` → score **40**. Correct recency weighting
(oldest→newest) gives `130.7` → `+37.7%` → score **70**. A genuine 38% ramp is
under-reported by one severity band — a missed injury-risk signal. The bias sign
flips with trajectory (declining history can over-report).

**Minimal fix:** iterate oldest→newest, e.g. `for vol in reversed(active_volumes[:-1])`
seeding on `active_volumes[-1]`, or reverse `active_volumes` before the loop.
**Regression sketch:** `_volume_spike_signal(180, [200,150,100,100,100], [True]*5)`
must score `70.0`, not `40.0`; keep a constant-series test to pin alpha.

---

### 4. NP and the best-power curve drop zero-watt samples, inflating TSS, FTP and VO2max

**Evidence:** `tss.py:81` (`clean = [... if p is not None and float(p) > 0]`) and
`power_curve.py:302` (`power_data = [... if p is not None and float(p) > 0]`). Zeros
(coasting) and nulls are removed *before* the 30 s rolling average / prefix-sum,
compressing the timeline. NP is live for TSS backfill: `api/cycling/training_load.py:112-117`
writes this NP into `Activity.normalized_power`, then `auto_compute_tss_for_activity`
(`tss.py:150-157`) uses it. The same zero-filter feeds `compute_power_curve_from_streams`
→ `estimate_ftp_from_power_curve_detailed` (`power_curve.py:302-319`, `:393`) →
FTP history (`scheduler.py:1898`, `:1988`) and `estimate_vo2max` (`vo2max.py:78-80`).

**Concrete failing example (PROVEN arithmetic):** 10 min of 5 min @ 250 W + 5 min @ 0 W.
True NP (zeros retained) = `(0.5×250⁴)^0.25 = 210.2 W`; code returns **250.0 W**
(+19%). At FTP 250, true TSS = `(600×210.2×0.841)/(250×3600)×100 = 11.8`; code =
`(600×250×1.0)/… = 15.0` (**+27%**). A rider who coasts on descents gets inflated
TSS/CTL, and the same inflation raises best 20-min power → inflated FTP → zones
assigned in watts above true FTP.

**Minimal fix:** for NP, map `None`/non-finite to `0.0` and keep the zero samples
(only reject the all-zero case); for the power curve, keep zeros in the windowed
average (a 20-min best should include the seconds you stopped pedalling). Do *not*
change `best_power_rolling_average` itself (`power_curve.py:200-234`) — it is
correct; the callers filter.
**Regression sketch:** `compute_normalized_power([250.0]*300 + [0.0]*300) ≈ 210.2`;
`best_power_rolling_average([100,0,100],3) == 66.7`; and an all-zero stream still
returns `None`.

---

### 5. CTL EWMA uses only a 90-day warm-up for τ=42, biasing TSB negative for everyone

**Evidence:** `training_load.py:35-43` — the loop begins at `end_date − 90 d` with
`ctl = 0.0`, then runs 90 steps. With τ=42, convergence from 0 is only
`1 − e^(−90/42) = 88.3 %`.

**Concrete failing example (PROVEN arithmetic):** an athlete in steady state at
100 TSS/day: ATL converges to ~100, CTL reads `100 × 0.883 = 88.3`, so
`TSB = CTL − ATL ≈ −11.7` instead of 0. All 90-day callers inherit this:
`api/dashboard/today.py:53`, `adaptive.py:483`, `training_plan.py:862`,
`projections.py:674`, `api/workout_planner.py:55`. In `get_readiness_recommendation`
(`workout_planner.py:159-185`) that puts a fully-recovered athlete in the
"Neutral / moderate only" band (`tsb > −10` fails), and it biases every TSB-gated
decision toward fatigue. The test suite only asserts `ctl > 80` for this exact
scenario (`tests/test_cycling.py:184`), so it passes while encoding the bias.

**Minimal fix:** seed/iterate over ≥5τ for CTL (≥210 days) before the reported
endpoint, or accept a `initial_ctl` seed. The same applies to ATL but τ=7 makes it moot.
**Regression sketch:** 365 days at 100 TSS/day → last `ctl >= 99.0` and `abs(tsb) < 1.0`.

---

## Additional safety-relevant finding (plan-quality)

The FTP weighted mean at `power_curve.py:150-167` includes the crude `5-min × 0.95`
(confidence 0.5, `:123-124`) and the three Riegel extrapolations (confidence 0.3–0.6,
`:132-145`), then reports `confidence = max(...)` = 1.0 (`:162-163`) even though the
*value* is a blend dominated by lower-confidence estimates. Example (PROVEN
arithmetic): curve `{5:380, 10:340, 20:310, 30:300, 60:285}` → blend = **299.9 W**
vs the 20-min gold-standard **294.5 W**; excluding the low tiers gives 291.9 W. The UI
labels this "20-min × 0.95" with confidence 1.0. Fix: only blend tiers at comparable
confidence, or return the highest-confidence estimate and report the blend's weighted
mean confidence separately.

---

## Main table

| Algorithm | file:line | Literature | Code does | Verdict | Severity |
|---|---|---|---|---|---|
| Power TSS | `tss.py:29` | `(s·NP·IF)/(FTP·3600)·100` | exact | correct (PROVEN) | — |
| Normalized Power | `tss.py:73-96` | 30 s rolling avg → 4th-power mean; zeros are valid samples | drops `None` **and `≤0`**, then 30 s window on compressed data | wrong-risky (PROVEN) | safety-critical |
| hrTSS | `tss.py:33-54` | TrainingPeaks: `hours·(avgHR/LTHR)²·100` (quadratic) | linear `hours·(HRR ratio)/1.0·100`; hard-codes threshold = 100 % HRR (`:51`) | wrong-risky (PROVEN); **no call sites** (only re-exported `__init__.py:42`) | cosmetic (dead) |
| IF / VI | `tss.py:57-70` | NP/FTP, NP/AP | exact | correct (PROVEN) | — |
| VAM | `tss.py:99-103` | gain/h | exact | correct (PROVEN) | — |
| CTL/ATL EWMA | `training_load.py:36-37,51-52` | `1−e^(−1/τ)` | exact | correct (PROVEN) | — |
| CTL warm-up | `training_load.py:35-43` | seed ≥4–5τ | starts at 0 with 90 d | wrong-risky (PROVEN) | safety-critical |
| TSB projection | `projections.py:177-178` | prefer `1−e^(−1/τ)` | `/42`, `/7` | wrong-risky (documented divergence; impact only) | cosmetic |
| FTP 20-min | `power_curve.py:103-104` | ×0.95 gold | exact | correct (PROVEN) | — |
| FTP 60-min | `power_curve.py:99-100` | 60-min ≈ FTP | direct, conf 0.9 | correct (PROVEN) | — |
| FTP 8-min | `power_curve.py:111-113` | ×0.90×0.95 | exact | correct (PROVEN) | — |
| FTP 5-min | `power_curve.py:123-124` | FTP ≈ 0.83–0.87 × 5-min power | ×0.95 (conf 0.5) | wrong-risky (PROVEN) | plan-quality |
| Riegel P–D | `power_curve.py:66-78,127-145` | `P2=P1·(D1/D2)^0.06` derived from Riegel T2=T1(D2/D1)^1.06 | as coded; conf 0.3–0.6 | unverifiable (heuristic; algebra consistent with Riegel) | plan-quality |
| FTP blend/confidence | `power_curve.py:150-167` | weighted mean; confidence of the blend | includes 0.3–0.5 conf tiers; reports max conf 1.0 | wrong-risky (PROVEN) | plan-quality |
| FTP clamp | `power_curve.py:158`; `schemas/cycling.py:11-12,108` | 50–600 W | returns `None` outside (not clamp); write paths 422 | correct (PROVEN) | — |
| Bucket durations vs resolution | `power_curve.py:302-316` | one window sample = 1 s | ignores `ActivityStream.resolution` (`models/activity.py:179`; used by `zones.py:106`) | unverifiable (**SUSPECTED**: wrong if any stream >1 Hz) | plan-quality |
| ACSM VO2max | `vo2max.py:27-29` | `(10.8·W)/kg + 7` | exact | correct (PROVEN) | — |
| Uth VO2max | `vo2max.py:153-162` | `15.3·HRmax/HRrest` | exact | correct (PROVEN) | — |
| VO2max selection | `vo2max.py:169` | highest confidence | `max(conf, value)`; tie-break inflates | correct (documented); minor upward tie bias | cosmetic |
| VO2max sanity gate | `vo2max.py:95,107,119,155` | 20–90 ml/kg/min | exact | correct (PROVEN) | — |
| Decoupling formula | `vo2max.py:345-351` | TrainingPeaks: Pw:HR ratio per half from **ratio of averages** | mean of per-sample `p/h` ratios | wrong-risky non-standard (PROVEN) | plan-quality |
| Decoupling thresholds | `vo2max.py:288-300` | <5 / ≤8 / >8 % | exact | correct (PROVEN) | — |
| Coggan 7 power zones | `zones.py:13-21` | Z1 0–55 … Z7 150 %+ | exact | correct (PROVEN) | — |
| HR zones | `zones.py:24-31,115-116` | Coggan/Friel LTHR zones (`LTHR_HR_ZONES:34-40`) | normalises HR by LTHR but applies the **%HRmax-style `HR_ZONES`** table; `compute_hr_zones_from_lthr` (the correct one, `:53`) is unwired | wrong (PROVEN) | plan-quality |
| W/kg norms | `power_profile.py:9-15,29-42` | Coggan male | static male-only; clamps durations > 60 min to the 60-min value (too high), linear interpolation | unverifiable (approx.) | cosmetic |
| Planner zones | `workout_planner.py:20-26` | IF bands | exact | correct (PROVEN) | — |
| Readiness bands | `workout_planner.py:141-185` | TSB semantics | >25 / >5 / >−10 / >−30 | correct (conventional; arbitrary but stated) | — |
| Route-match weights | `workout_planner.py:537-562` | 35/25/25/15 | exact, renormalised over present signals; unridden power is derived *from* TSS → double-counts it | correct weights; **metric-dependence flaw** (PROVEN) | cosmetic |
| Unridden TSS | `workout_planner.py:289-312` | `h·IF²·100` | base IF 0.70, elevation adj cap +0.15, 25 km/h fallback | unverifiable (heuristic) | cosmetic |
| Calorie estimate | `workout_planner.py:251-255` | kJ ≈ kcal (×3.6) | ×4.0 → ~11 % high | wrong-risky (PROVEN) | cosmetic |
| Strength standards | `deficiency.py:37-46` | BW multiples | male-only, no sex/age/body-comp adjustment | unverifiable (conventional) | plan-quality |
| Big-3 ratios | `deficiency.py:143-157` | conventional | exact thresholds; displayed ideals (`:413-432`) disagree with flags (0.75–0.85 passes though "ideal 0.65–0.75") | correct logic, inconsistent display | cosmetic |
| Ratio advice direction | `deficiency.py:436` | choose below/above from the breached bound | `ctx["below"] if value < 1 else ctx["above"]` | **wrong** (PROVEN) | plan-quality (safety-adjacent) |
| Push/pull band | `deficiency.py:181-248` | ideal 1.0–1.3 | exact | correct (PROVEN) | — |
| Push/pull volume | `deficiency.py:498-505` | tonnage | `weight×reps`; bodyweight lifts contribute 0; returns `None` if either side 0 → pure-push users get no warning | wrong-risky (PROVEN) | plan-quality |
| Zone-distribution flags | `deficiency.py:678-736` | >80 % easy / >40 % Z4+ / <5 % Z3 | exact (elif-priority) | correct (coaching opinion; downstream of HR-zone bug) | plan-quality |
| OLS regression | `projections.py:34-75` | OLS | exact, `n<2` guarded, denom guard | correct (PROVEN) | — |
| Badges | `projections.py:119-150` | ≥4 pts | exact | correct (PROVEN) | — |
| Freshness bands | `projections.py:711-718` | TSB >5 optimal | exact | correct (conventional) | — |
| Adaptive thresholds | `adaptive.py:27-39` | cut TSB ≤−20 / raise ≥+5 / recovery <40 / conformity 70–90 | exact | correct (arbitrary but stated) | — |
| Adaptive clamps | `adaptive.py:358-391` | bounded | power 60–600, duration 30–600, TSS 10–400, vol 100–200000, RPE 1–10 (RPE is a bounded ordinal — multiplying is odd) | correct | cosmetic |
| Climb detection | `segments.py:29-42,157-218` | ≥3 % / ≥150 m / ≥30 m | exact | correct (thresholds conventional for "climb") | — |
| Climb category | `segments.py:142-154` | Strava score-based formula | gain×gradient ladder | unverifiable (arbitrary approximation) | cosmetic |
| Effort alignment | `segments.py:299-320,336-388` | distance-align + coverage | 25 m + 5 %, ≥90 % coverage; zeros dropped from power/HR means; first velocity sample not integrated (`:291`) | correct-ish; minor biases (PROVEN) | cosmetic |
| Health composite weights | `health_analysis.py:352,509,650-656` | 40/35/15/10, 55/45, 25/20/25/15/15 | exact | correct (PROVEN) | — |
| Illness RR redistribution | `health_analysis.py:657-662` | renorm by Σweights | `/0.80·100` | **wrong** (PROVEN) | safety-critical |
| Volume EWMA order | `health_analysis.py:162-174` | recency-weighted EWMA | oldest weighted most | **wrong** (PROVEN) | safety-critical |
| Overtraining TSB warm-up | `health_analysis.py:326-329` | full τ warm-up | `lookback_days=7` | **wrong** (PROVEN) | safety-critical |
| Severity bands | `health_analysis.py:269-277` | 85/65/45 | exact | correct (PROVEN) | — |
| Regen defaults | `health_analysis.py:798-802` | 8/15 %, 60/120 min, +5/+8 bpm | exact | correct (PROVEN) | — |

### Additional findings (lower priority)

- **Big-3 recommendation inversion (PROVEN, `deficiency.py:436`).** `value < 1` is used
  to pick the "below" advice. Example: deadlift 200 kg, bench 160 kg → bench:dead =
  0.80, flagged `medium` at `:156`; since 0.80 < 1 the code emits *"Bench lags
  relative to deadlift — add pressing volume"* (`:429`), the opposite of the correct
  "deadlift lags / bench dominant" advice. Same for bench:squat 0.85–1.0 (`:148`).
  Fix: compare against the metric's actual lower/upper bound, not `1`.
  Regression: `evaluate_big3_ratios(200,160,200)` → `bench_deadlift_ratio`
  recommendation must be the "above" text.
- **HR zone table (`zones.py:115-116`) drives deficiency zone flags.** Because
  `HR_ZONES` boundaries (0.68/0.83/0.95…) are applied to `hr/LTHR`, a large share of
  riding falls into Z1/Z2 (`:126-137`), which then trips `easy_pct > 80` →
  "missing intensity" (`deficiency.py:678-696`). Fix: use `LTHR_HR_ZONES` in
  `compute_hr_zones_from_streams` (or call the existing `compute_hr_zones_from_lthr`);
  regression: an hour at exactly LTHR must report >90 % in Z4.
- **Stream resolution (SUSPECTED, `power_curve.py:302`).** If
  `ActivityStream.resolution > 1`, a "300 s" bucket is actually 300 samples
  (300×resolution seconds), inflating short-duration bests. Confirm against
  production `resolution` values before changing.
- **VO2max history weight (`vo2max.py:197,253-258`).** Every historical month uses
  the *current* profile weight, so weight-change-driven VO2max trends are distorted.
- **Non-finite handling:** NP/power-curve filter `None` and `≤0` but not `+inf`
  (`tss.py:81`, `power_curve.py:302`); `zones.py:112,189` and `segments.py:327-330`
  do guard `isfinite`. Cosmetic.
- **`calculate_hr_tss` default `resting_hr=60` (`tss.py:37`)** would silently
  substitute 60 bpm if ever wired; keep unwired or require the argument.
- **Terminology:** `_sleep_efficiency_signal` α computed as `1−e^(−1/2)` is a 2-day
  *time constant*, not the "2-day half-life" stated (`health_analysis.py:130-131`);
  same for "4-week half-life" volume EWMA (`:170-171`). More aggressive recency
  weighting than the comment implies.

### CTL divergence impact (reported, not fixed, per constraints)

`training_load.py:36-37` uses `1−e^(−1/τ)`; `projections.py:177-178` uses `/τ`. Over
a 14-day zero-TSS taper from CTL 70 / ATL 70: CTL 49.95 (proj) vs 50.16 (EWMA);
ATL 8.09 vs 9.47; **TSB differs by ~1.2 points**, TSB error ≤ ~0.2 for CTL. Impact
is below the resolution of every downstream band (freshness steps are 5 points), so
this is cosmetic — do not prioritise.

---

## Appendix — full threshold inventory

**`cycling/tss.py`**
- NP min samples: `30` — `:78`, `:82`; rolling window `30` s — `:87-91`; NP samples
  `≤0` dropped — `:81`; VAM divisor `3600` — `:103`; hrTSS `threshold_hrr = 1.0` —
  `:51`; default `resting_hr=60` — `:37`.

**`cycling/training_load.py`**
- `CTL_DAYS=42` — `:14`; `ATL_DAYS=7` — `:15`; warm-up `lookback_days=90` — `:24`,
  loop start `:35`, seed 0 `:40-41`; W/kg bands 2.0/3.0/4.0/5.0/10.0 — `:72-78`;
  CTL bands 30/60/100/500 — `:79-84`; VI bands 1.05/1.10/1.20/2.0 — `:85-90`.

**`cycling/power_curve.py`**
- Buckets 5–7200 s — `:15-30`; 60-min direct conf `0.9` — `:100`; 20-min `×0.95`
  conf `1.0` — `:104`; 30-min `×0.95` conf `0.95` — `:108`; 8-min `×0.90×0.95`
  conf `0.85` — `:113`; 10-min `×0.92×0.95` conf `0.7` — `:119`; 5-min `×0.95`
  conf `0.5` — `:124`; Riegel exponent `0.06` — `:77`, sources/conf `0.6/0.4/0.3` —
  `:127-145`; clamp `50–600` — `:137`, `:158`; cache TTL `3600` s — `:193`;
  zero filter — `:302`.

**`cycling/vo2max.py`**
- ACSM coefficient `10.8` + intercept `7` — `:29`; VO2 classes 35/45/55/65/75 —
  `:38-49`; sanity `20–90` — `:95,107,119,155`; 5-min conf `0.7` / default weight
  `75 kg` conf `0.4` — `:99,106-114`; 8-min conf `0.6` — `:122`; Uth `15.3` conf
  `0.6` — `:154,157`; selection `max(conf,value)` — `:169`; decoupling min samples
  `60` / half `30` — `:320,333,341`; decoupling bands `5/8` — `:295-300`.

**`cycling/zones.py`** — power zone edges `0.55/0.75/0.90/1.05/1.20/1.50/5.0` —
`:13-21`; HR (`HR_ZONES`) edges `0.68/0.83/0.95/1.05/1.18/5.0` — `:24-31`; LTHR
edges `0.80/0.89/0.95/1.05/5.0` — `:34-40`; live path uses `HR_ZONES` — `:116`.

**`cycling/power_profile.py`** — percentiles `[25,50,75,90]` — `:17`; table durations
`5/60/300/1200/3600` — `:9-15`; clamp-at-ends interpolation — `:29-42`.

**`workout_planner.py`** — IF bands `0.55/0.75/0.90/1.05/1.20` — `:20-26`; readiness
`25/5/−10/−30` — `:141-185`; TSS/hr `IF²·100` — `:98`; calories factor `4.0` —
`:253`; unridden base IF `0.70`, elevation cap `0.15`, 25 km/h fallback —
`:294,298,304`; match weights `0.35/0.25/0.25/0.15` — `:541-562`; unridden penalty
`0.85`, confidence `0.3` — `:502,509`; ridden confidence `ride_count/5` — `:434`.

**`deficiency.py`** — standards squat `1.0/1.5/2.0/2.5`, bench `0.6/1.0/1.4/1.8`,
deadlift `1.2/1.75/2.4/3.0` — `:37-46`; bench:squat flags `0.55/0.65/0.85` —
`:144-149`; dead:squat `1.0/1.35` — `:152`; bench:dead `0.45/0.75` — `:156`;
push/pull bands `0.7/1.0/1.3/1.6` — `:196-248`; FTP classes `2.5/3.2/4.0` (W/kg)
and `200/250` (W) — `:256-271`; zone flags `80 %/40 %/5 %` — `:678-736`; decoupling
min rides `3` — `:612`; recommendation gate `value < 1` — `:436`.

**`projections.py`** — `n<2` guard — `:48`; R² clamp `0–1` — `:73`; badge gate `4` —
`:134`; At-Risk window `+30 d` — `:147`; CTL/ATL divisors `42/7` — `:168-178`;
freshness `5/−5/−10` — `:711-718`.

**`adaptive.py`** — `TSB_FATIGUE_THRESHOLD=−20` — `:27`; `TSB_OVERLOAD_THRESHOLD=5` —
`:29`; `RECOVERY_LOW=40` — `:31`; conformity `70/90` — `:33-34`;
`CUT_FACTOR=0.85` / `RAISE_FACTOR=1.08` — `:36-37`; action limit `3` — `:39`;
clamps power `60–600`, duration `30–600`, TSS `10–400`, volume `100–200000`,
RPE `1–10` — `:376-391`.

**`segments.py`** — local rise `0.3 m`, gap `8 m`, min gain `30 m`, min gradient
`3 %`, min length `150 m` — `:29-33`; alignment tol `25 m` + `5 %`, coverage
`90 %` — `:35-37`; local climb gradient `0.4 %`, flat tail `200 m` — `:39-41`;
categories HC `7.5 %/900 m`, 1 `5 %/450 m`, 2 `5 %/150 m`, 3 `4 %/100 m`,
4 `3 %/30 m` — `:144-154`.

**`health_analysis.py`** — TSB `<−35`, consecutive `1/3/5` — `:40-50`; recovery
absolute `15/25/35`, consecutive `2/3/4` (<40) — `:66-87`; HRV declines
`10/15/20 %`, min `3` pts — `:99-114`; sleep EWMA α=`1−e^(−1/2)`, bands
`70/78/83` — `:131,136-142`; volume EWMA α=`1−e^(−1/4)`, bands `20/30/50 %`, min
`2` active weeks — `:167-187`; rest days `4/5/7` — `:195-201`; RR elevation
`5/7/10 %` — `:215-221`; unexplained fatigue `35/45` — `:239-243`; illness
recovery `15/25/35` — `:257-263`; severity `85/65/45` — `:271-277`; overtraining
weights `0.40/0.35/0.15/0.10` — `:352`; injury weights `0.55/0.45` — `:509`;
illness weights `0.25/0.20/0.25/0.15/0.15` — `:650-656`, redistribution `*100` bug
`:662`; min metrics `3` — `:309,574`; overtraining lookback `7` — `:328`; regen
defaults — `:798-802`; RHR min readings `5` — `:1046`; perf-decline history `4` —
`:917`; sleep-consistency min nights `3` — `:990`.

**Verification gaps found in tests:** `tests/test_health_analysis.py:79-116` uses
constant prior volumes (hides the EWMA-order bug) and never exercises the
illness/overtraining composites (hides `:662` and `:328`);
`tests/test_cycling.py:184` asserts only `ctl > 80`, which passes with the 88.3
warm-up bias.
