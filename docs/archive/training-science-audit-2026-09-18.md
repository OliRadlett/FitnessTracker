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
>
> **Run 2 (2026-09-18, same day):** full re-audit of the post-fix tree covering
> all training-science domains (cycling, ride analysis, strength, planning,
> recovery, nutrition, route heuristics) — appended below as
> "Run 2 follow-up audit". Verifies fix completeness across call sites,
> second-order effects, tests, and adds new findings with evidence traces.
> Read-only: no code changed.

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

---

## Run 2 follow-up audit (2026-09-18)

> Read-only verification of the post-fix tree. Scope extended beyond run 1 to
> ALL training-science domains: `services/cycling/` (all 7 files),
> `session_analysis.py`, `activity_context.py`, `lifting.py`, `deficiency.py`,
> `charts.py` (strength charts), `goal_metrics.py`, `workout_planner.py`,
> `training_plan.py`, `conformity.py`, `adaptive.py`, `projections.py`,
> `health_analysis.py`, `whoop.py` (intelligence helpers), `nutrition.py`,
> `effort_estimator.py`, `route_quality_service.py`, `route_collection_rules.py`,
> `segments.py`. **PROVEN** = traced in code (`file:line`); **SUSPECTED** =
> needs runtime data.
>
> Scope note: `nutrition.py` is ride-fueling only (no BMR/TDEE/macro/deficit
> equations exist in the codebase), so there were no invented energy
> coefficients to audit.

### Run-2 fix verification — completeness across call sites

| Fixed item | Complete? | Evidence / second-order effect |
|---|---|---|
| Illness-composite scaling | ✅ | `/0.80` renormalisation correct (`health_analysis.py:285-309`). |
| Overtraining TSB window | ✅ | 180+210 fetch, slice last 7 (`health_analysis.py:362-365`). |
| Volume-EWMA ordering | ⚠️ partial | Reversed to oldest-first seed (`health_analysis.py:175-179`); unit test `test_health_analysis.py:119-127` passes, but the seed still carries the **largest single weight** (`(1−α)^4 = 0.368 > α = 0.221`), so the "recent weeks carry the most weight" docstring is false for the 5-week live path. |
| Zero-preserving NP/power-curve | ⚠️ partial | `tss.py:74-102`, `power_curve.py:308-336` correct; **`prs.py` still drops zeros and ignores resolution** (new finding #2 below). |
| CTL warm-up + widened fetches | ⚠️ partial | Most call sites fetch `lookback+210` (api/power, api/training_load, dashboard, activities, adaptive, training_plan, charts, llm_analysis); **`tasks/scheduler.py:1562-1564` fetches only 90 d** (known open, confirmed live); `charts.ramp_rate` (`charts.py:1780-1785`) is short by 42 warm-up days (minor). |
| FTP tier gating + 5-min ×0.85 + blend confidence | ✅ code, ⚠️ wiring | `power_curve.py:123-126,156-174` correct; but the **8-min tier is dead** — `480 ∉ POWER_DURATION_BUCKETS` (`power_curve.py:15-30`) so `power_curve.py:112-115`, `api/cycling/ftp.py:122` (`best_power_available["8min"]` always None) and `vo2max.py:80-81,118` never fire. `api/cycling/ftp.py:91` docstring still says "5-min × 0.95". |
| LTHR zone table | ✅ | `zones.py:35-41`; `HR_ZONES` (6-zone %HRmax) unused, no downstream break. |
| Big-3 advice direction | ✅ | `_BIG3_RATIO_CONTEXT` bounds used (`deficiency.py:165-195`); tested `test_deficiency.py:103-123`. |
| One-sided push/pull + wording + bodyweight sets | ⚠️ partial | One-sided severity correct; bodyweight counted (`deficiency.py:546-550`); **0.7–1.0 band recommendation direction wrong** (new finding #5). |
| Calorie ×3.6 | ✅ | `workout_planner.py:251-256`; but `effort_estimator.py:261` uses kJ×1.1 (~10 % divergence). |
| Decoupling ratio-of-means | ✅ | `vo2max.py:375-388`; tested `test_cycling.py:157-164`. |
| Resolution-aware windows | ⚠️ partial | OK in power curve/zones/VO2/history; **not in `prs.py`**. |
| Unridden-power exclusion | ✅ | `workout_planner.py:485-497` (power weight dropped for estimates). |
| Historic VO2max weights | ✅ | `vo2max.py:203-284` (weigh-in ≤ window_end, `weight_defaulted` flag). |
| RPE rounding | ✅ | `adaptive.py:391-395`. |
| Quadratic hrTSS | ✅ math, ❌ wiring | `tss.py:33-55` quadratic; **zero production callers** (new finding #3). |

### New top-5 safety-critical issues (run 2)

#### 1. A high-rep back-off set dethrones a true near-maximal PR

`brzycki_1rm` (`lifting.py:34-40`) has no rep ceiling (Brzycki degrades beyond
~10–12 reps; only `reps ≥ 37` guarded). `_check_and_record_pr` compares raw
`estimated_1rm > current` with no rep filter (`lifting.py:525,555`);
`create_manual_pr` (`lifting.py:817,831`) and
`_recalculate_pr_after_set_change` (`lifting.py:598,615`) share it.
`cleanup_orphaned_prs` (`lifting.py:894`) additionally lacks the `reps<37`
guard (division-by-zero risk) and updates *all* record types.

Failing example: true PR `100 kg × 5` → `100·36/32 = 112.5 kg`; back-off
`60 kg × 20` → `60·36/17 = 127.1 kg` → PR row overwritten to 60×20
(`50 kg × 30` → 257 kg). Minimal fix: restrict 1RM-PR contention to
`reps ≤ 12` (keep raw estimates for display). Regression sketch: session with
`(100,5)` then `(60,20)` must leave the PR at 100×5.

#### 2. Cycling PR scan drops zero watts and ignores stream resolution

`_get_activity_power_data` filters `float(p) > 0` (`prs.py:76`);
`_compute_power_curve_alltime` filters the same (`prs.py:376`) and calls
`best_power_rolling_average(power_data, duration_sec)` with the raw sample
count (`prs.py:101,392`) instead of `round(duration_sec/resolution)` — the
fix applied to `power_curve.py:308-336` was never carried to `prs.py`.

Failing example: 120 s of alternating 10 s @300 W / 10 s coast (1 Hz). True
best 60 s = 150 W (main curve returns 150); `prs.py` strips the 60 zero
samples so the 60 nonzero samples become contiguous → best 60 s = 300 W,
written as an all-time PR. Minimal fix: keep zeros, scale the window by
`resolution`, reuse the shared helper. Regression sketch: a coast-heavy ride
must produce identical 60 s bests in both paths.

#### 3. HR-only rides contribute zero training load (hrTSS is dead code)

`calculate_hr_tss` (`tss.py:33-55`) has no production caller (only tests +
package export). `auto_compute_tss_for_activity` returns `None` without FTP
(`tss.py:152-153`) and only computes power TSS (`tss.py:160`), contradicting
the "hrTSS fallback" claim in `docs/algorithms.md:23`.

Failing example: an FTP-less user (or a power-meter-less ride) logs
3 × 90 min Z2 rides → all `tss=None` → `get_daily_tss` omits them →
CTL/ATL ≈ 0 → overtraining alerts (`health_analysis.py:382`), adaptive advice
(`adaptive.py:492`), readiness and race-day TSB all see a falsely fresh
athlete. Minimal fix: wire `calculate_hr_tss(duration, avg_hr, LTHR, rest)`
when power/NP is unavailable; keep `None` when no threshold exists.
Regression sketch: an HR-only activity must land in `get_daily_tss`; missing
LTHR must still yield `None`.

#### 4. Health-alert severity taken by alphabetic `max()` — critical reported as warning

`adaptive.py:547-550` computes
`max((a.severity for a in alerts if a.severity in _SEVERITY_ORDER))` without
the severity-rank key (`_SEVERITY_ORDER`, `adaptive.py:41`, is unused).
Failing example: alerts `["critical","warning"]` → `"warning"` (string order),
so the health axis and suggestion (`adaptive.py:286-307`) under-call a
critical condition. Minimal fix: `max(..., key=_SEVERITY_ORDER.get)`.
Regression sketch: mixed-severity alerts must yield `alert_severity ==
"critical"` (structurally untested today — only the pure `derive_*` path has
unit tests).

#### 5. Push/pull advice tells a push-deficient athlete to add pulling

`evaluate_push_pull_ratio` (`deficiency.py:273-283`): ratio `push/pull < 1.0`
means **more pulling than pushing**, yet the recommendation for the 0.7–1.0
band is `"Add one extra pulling movement per upper-body session"` —
the opposite direction (failing example: push 8000 / pull 10000 → ratio 0.80
→ advice adds pulls). The `>1.0` branches (`deficiency.py:296,307-309`) are
correct. Minimal fix: prescribe *pressing* volume in the 0.7–1.0 band; also
reconsider the ideal band itself — ground-truth coaching norms favour
pull ≥ push, so `1.0–1.3` is arguably inverted. Regression sketch: assert on
the `recommendation` text, not just `severity` (`test_deficiency.py:161-169`
asserts severity only — exactly why this slipped through).

### Run-2 consistency audit (same concept, multiple implementations)

| Concept | A | B | Divergence |
|---|---|---|---|
| Brzycki 1RM | `lifting.py:34-40` | `charts.py:724` (`max(37−r,1)`) | r=0: `W` vs `0.973·W`; r≥37: `W·2` vs `W·36` |
| Best rolling power | `power_curve.py:212-246` (zeros kept, res-aware) | `prs.py:76,101,376,392` (zeros dropped, res ignored) | PR values ≠ main curve (finding #2) |
| Calories | `workout_planner.py:251-256` (W·h·3.6 kcal) | `effort_estimator.py:258-261` (kJ·1.1) | ~10 % disagreement |
| FTP W/kg classes | `deficiency.py:317-334` (2.5/3.2/4.0) | `training_load.py:84-91` (2/3/4/5) | same value, different label |
| Bodyweight | `goal_metrics.py:55-67` (latest `WeightLog`) | `goal_metrics.py:241-244`, `deficiency.py:390-392`, `nutrition.py:186-191`, `vo2max.py:87-88` (`CyclingProfile.weight_kg`); `vo2max.py:203-213` period-correct `WeightLog` | four sources, unreconciled |
| "sleep_consistency" | `whoop.py:1061-1112` (bedtime σ, `100−σ/120·100`) | `health_analysis.py:983-1051` (duration σ, 60/120 min) | same name, different definition |
| `exercise_name` normalisation | `lifting.add_set` (`lifting.py:362`) normalises | `lifting.create_session` (`lifting.py:89-101`) does not | duplicate PR keys per alias |
| NP in ride context | `session_analysis.py:406` computes NP but omits it from the return dict (`:523-536`) | `activity_context.py:86` reads `analysis["normalized_power"]` | `ride.normalized_power` always `None` in cached context (`api/activities.py:1218-1229`) |
| Segment means | `segments.py:323-333` drops `0` | `tss.py:74-102` keeps `0` | segment avg power inflated |

### Run-2 known-open-item assessments

- **`tsb_projection` linear `/42`,`/7` vs EWMA.** Per-day factor 0.023810 vs
  0.023530 (~1.2 % relative). For a 300-TSS/week athlete the 14-day CTL error
  is <1 point — below every downstream band resolution. Quantified: cosmetic,
  do not change.
- **`tasks/scheduler.py` warm-up.** Confirmed live: seed-at-0 with only 90 d
  biases CTL ≈ 11.7 % low for steady-state users; only feeds Modal segment
  difficulty (`user_fitness["ctl"]`). Low blast radius.
- **Male-only strength tables.** `deficiency.STANDARDS` (`deficiency.py:37-46`)
  carries no male/sex/age qualifier (honesty gap); `power_profile.py:4-6` is
  explicitly "male… rough bands"; `segments.climb_category` is labelled
  "Strava-style". Only the strength table needs a label.
- **Additional run-2 edges (plan-quality, not top-5):** `project_to_target`
  returns `None` for already-achieved goals → badge "Unlikely"
  (`projections.py:94-119,140-141`); `race_day_tsb` is really
  today+`days_ahead` (API default 14, `api/projections.py:77`), not the event
  date — only `pdf_report.py:752-753` passes the true horizon;
  `compute_metric_trend` 1RM/big3/BW-ratio trends are structurally empty
  because PRs are updated in place (one row per exercise); `route_quality`
  docstring weights (30/20/25/25) disagree with code (25/15/20/25/15,
  `route_quality_service.py:4-9` vs `:29-35`); smart-collection `surface_type`
  is ANDed (`.has_key` per surface, `route_collection_rules.py:67-70`) though
  list semantics imply OR; ACSM coefficient `10.8` vs literature-derived
  `11.016` and submaximal-equation-on-maximal-effort mismatch
  (`vo2max.py:28-30`); Uth HRrest has no staleness bound
  (`vo2max.py:141-151`); plan templates provide no strength overload
  (weights `None`, fixed RPE) and no deload in `build`
  (`training_plan.py:288-371`); climb `est_speed` comment vs formula mismatch
  (`route_quality_service.py:147-151`); carb ceiling 100 g/hr exceeds the
  conventional 90 g/hr multi-transportable bound without a stated
  glucose:fructose ratio (`nutrition.py:47-58`).

### Run-2 test-suite grading

Covered well: TSS/NP/VI (`test_cycling.py`), rolling-average helper
(`test_power_curve.py`), adaptive pure inference (`test_adaptive.py`),
volume-spike constant series, illness-composite scaling. Structural gaps:
`evaluate_push_pull_ratio` recommendation direction (severity-only asserts),
hand-built `{480:…}` FTP test masking the dead 8-min tier, PR-contention with
high-rep sets untested, `generate_adaptive_suggestions` alert-severity path
untested, 1RM-trend emptiness untested, hrTSS wiring untested (no caller to
test). Missing regression sketches are given per finding above.

### Run-2 not verified (production data needed)

prs.py inflation magnitude (real coast-heavy streams + stored PRs);
power/HR stream offset/resolution misalignment in decoupling; Uth HRrest age
distribution; volume-EWMA seed bias on real ramps; `PersonalRecord`
row-count-per-exercise (trend emptiness); `get_daily_tss` DB-timezone date
bucketing; frontend `days` param for `GET /projections/tsb/{plan}`;
segment zero-drop impact; NULL-`tss`-with-HR activity share. Modal
containers, LLM prompts, frontend out of scope.

---

## Run 2 implementation status (2026-09-18, same session)

> All code changes below are implemented and verified (unit tests on host;
> DB-backed paths verified against `fittrack_test` with rolled-back
> transactions; host lacks `fastapi`/`redis`/`prometheus_client`, so the new
> `tests/integration/*` files run in CI/container). Read-only audit sections
> above are unchanged. Not committed — awaiting review.

Implemented (maps to run-2 findings):

1. **Brzycki PR rep cap** (`lifting.py: MAX_REPS_FOR_1RM_PR = 12`): only
   `1..12`-rep working sets contend in `_check_and_record_pr`,
   `_recalculate_pr_after_set_change`, `cleanup_orphaned_prs`
   (which also gained the missing `reps < 37` guard and a
   `record_type == "1rm"` filter); `create_manual_pr` raises `ValueError`
   outside the range (API maps to 400); `create_session` normalises exercise
   names like `add_set`; `charts.py` uses the shared `brzycki_1rm`.
   Tests: `tests/integration/test_lifting_pr_rep_cap.py`.
2. **Cycling PR zero/resolution parity** (`prs.py`): both PR paths keep zeros,
   scale windows by `stream.resolution`, and share the rolling-average helper
   with the main curve; `8min` label added. Tests:
   `tests/integration/test_cycling_pr_zeros.py`.
3. **hrTSS wired** (`tss.py: auto_compute_hr_tss_for_activity`, exported from
   `cycling/__init__.py`): power TSS preferred; fallback needs profile LTHR
   + resting HR ≤30 d old. Tests:
   `tests/integration/test_hr_tss_fallback.py`.
4. **Alert severity ranking** (`adaptive.py: _worst_alert_severity`): worst by
   rank, not alphabetic `max()`. Tests: `tests/test_adaptive.py`.
5. **Push/pull advice direction** (`deficiency.py`): 0.7–1.0 band now
   prescribes pressing; recommendation text asserted in
   `tests/test_deficiency.py`.
6. **8-min bucket live** (`power_curve.py`: `(480, "8min")`): FTP 8-min tier,
   FTP API `8min` field, and VO2max 8-min signal now fire. Tests:
   `tests/integration/test_power_curve_buckets.py`.
7. **ACSM 10.8 → 11.016** (`vo2max.py`, `docs/algorithms.md`); **Uth HRrest
   ≤30 d bound** (`vo2max.py`). Tests: `TestAcsmVo2max`,
   `test_power_curve_buckets.py`.
8. **Met-goal projection** (`projections.py`): 0 days remaining → On Track
   (existing test updated); **race_day_tsb** = event-date entry when inside
   the window (`test_tsb_projection_event.py`); **ramp_rate** TSS fetch covers
   the full warm-up.
9. **1RM-family trends from session sets** (`projections.py:
   _session_best_1rm_by_date`): estimated_1rm / BW-ratio (period-correct
   weight + profile fallback) / big3_total now return real history. Tests:
   `tests/integration/test_metric_trend_history.py`.
10. **Small fixes**: smart-collection `surface_type` OR;
    `analyze_ride` returns `normalized_power` (single computation; schema
    `RideAnalysisResponse` + cached context carry it); stale docstrings
    corrected (route-quality weights, FTP 5-min ×0.85, 4-wk time constant,
    male-based strength norms comment).

Deliberately NOT changed: `tasks/scheduler.py` warm-up fetch (owned by
another session per the run-1 header); push/pull ideal-band direction and
volume-EWMA weighting (judgment calls — docstrings corrected instead);
TSB `/42` projection (quantified cosmetic); SUSPECTED items needing
production data (decoupling alignment, `get_daily_tss` timezone, segment
zero-drop impact).
