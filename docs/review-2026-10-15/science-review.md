# FitTrack — Science Review

> **Date**: 2026-10-15 · **Commit**: `5f54f40` (detached HEAD, clean tree) · **Mode**: read-only
> **Method**: every numerical claim below was read from the implementation at the commit
> above (`path:line`), then checked against the primary literature / platform documentation
> via web search. Where a formula is reproduced faithfully it is listed under **Verified
> correct** so future sessions do not re-litigate it. Citations are keyed `[S#]` and listed
> at the end.
>
> **Scope**: physiological / sports-science algorithms — TSS family, FTP & VO2max, decoupling,
> zones, climbing categories, lifting load & 1RM, VBT, nutrition, health composites. UI,
> data-integrity and dead code are covered by the sibling documents in this directory.

---

## Summary of findings

| ID | Area | Finding | Severity | Confidence |
|----|------|---------|----------|-----------|
| S1 | VO2max bands | "General-population norms" are ~1 fitness class higher than any published population chart, and are not age/sex-adjusted | **High** (user-facing misclassification) | High |
| S2 | Climb categories | `climb_category()` is labelled Strava-style but does not implement Strava's score; app over-rates Cat 2–4 and mis-rates HC | **High** (Strava users compare directly) | High |
| S3 | Decoupling | Uses **mean** power per half; TrainingPeaks (which the comment cites) uses **Normalized** Power | Medium | High |
| S4 | Decoupling | No steady-state / aerobic gating (VI, Z1–3), which TP explicitly requires for the metric to be meaningful | Medium | High |
| S5 | Lifting TSS | Comment attributes the formula to "Foster's method"; Foster's is `RPE × duration`, not a tonnage product | Medium | High |
| S6 | HR zones | `LTHR_HR_ZONES` cites "Andy Coggan" but the boundaries (80/89/95/105 %LTHR) match neither Coggan's nor Friel's published tables | Medium | High |
| S7 | VO2max citation | FRIEND PMID 29692203 is attributed to "Nes et al."; it is **Kokkinos et al. (2018)**. File also states both ">4×" and "~30×" lower error | Medium | High |
| S8 | LD/TSB | `TSB = CTL_t − ATL_t` includes the current day's TSS; TrainingPeaks defines today's TSB from **yesterday's** values | Medium | High |
| S9 | Power profile | p50 values sit ~2 Coggan categories below the "trained-male-rider" label; provenance not traceable to a published percentile table | Low–Med | Medium |
| S10 | VO2max input | FRIEND was derived on **peak ramp work rate**, not 5-min best power; the 8-min→5-min Riegel conversion compounds the proxy error | Low–Med | Medium |
| S11 | Nutrition | Gut-training note says >90 g/h needs fructose:glucose ≈1:2, but 2:1 glucose:fructose is the ratio studied **up to** 90 g/h; >90 g/h calls for more fructose | Low–Med | High |
| S12 | Ramp rate | "+3 to +8 CTL/wk optimal" sits at the aggressive end; consensus "safe" band is 3–5, with 7–8 the ceiling | Low | High |
| S13 | Health composites | Overtraining/injury/illness weights and TSB thresholds (−35, −20) are heuristics with no cited validation and are internally inconsistent | Low | High |
| S14 | Adaptive τ fitting | Fitting CTL/ATL τ by maximising TSB–HRV correlation is non-standard and risks overfitting (partly mitigated by ≥45 samples / R² ≥ 0.10) | Low | Medium |

---

## Verified correct (do not re-chase)

| Component | Check | Verdict |
|-----------|-------|---------|
| Power TSS `tss.py:19` | `(s × NP × IF)/(FTP × 3600) × 100`, `IF=NP/FTP` | ✅ exact TrainingPeaks TSS |
| Normalized Power `tss.py:80` | 30 s rolling avg → 4th-power mean → 4th root; keeps 0 W, drops only null/non-finite; requires ≥30 samples | ✅ standard Coggan NP |
| hrTSS `tss.py:39` | `hours × (%HRR)^2 × 100` where `%HRR = (HR−HRrest)/(LTHR−HRrest)` | ✅ matches TP's HR-based IF² form |
| CTL/ATL `training_load.py:29` | `x + (TSS−x)(1−e^(−1/τ))`, τ=42/7, 5τ (210 d) warm-up | ✅ canonical PMC |
| FRIEND equation `vo2max.py:30` | `1.74 × (W×6.12/kg) + 3.5` | ✅ algebraically `10.649 × W/kg + 3.5`, exactly the published FRIEND-ergometry equation [S1] |
| Legacy ACSM `vo2max.py:43` | `11.016 × W/kg + 7` | ✅ = `1.8 × 6.12 × W/kg + 7`, the ACSM leg-ergometry equation in the same units |
| Uth HR method `vo2max.py:201` | `15.3 × HRmax/HRrest`, resting HR ≤30 d, conf 0.6 | ✅ correct coefficient; see caveat below |
| Coggan power zones `zones.py:13` | 55/75/90/105/120/150 %FTP | ✅ Coggan 7-zone model |
| FTP tiers `power_curve.py:142` | 20-min ×0.95 (conf 1.0), 8-min ×0.90, 30-min ×0.97, 5-min ×0.85, clamp 50–600 W | ✅ Allen/Coggan field-test factors; the invented 10-min tier was correctly removed |
| Riegel extrapolation `power_curve.py:116` | `P2 = P1 × (D1/D2)^0.06` | ✅ defensible: reproduces ≈0.94× factor for 20→60 min; empirical exponent literature 0.05–0.10 |
| Morton 3-param `power_models.py` | `k = W'/(Pmax−CP)` | ✅ Morton (1996) [S10] |
| Brzycki `lifting.py:40` | `w × 36/(37−reps)`, reps>12 callers guard, `%1RM` inversion for RPE | ✅ correct form and rep-range discipline [S9] |
| VBT MVTs `vbt.py:22` | squat 0.30, bench 0.15, deadlift 0.15, press 0.20 m/s | ✅ González-Badillo / Lake values [S11] |
| Big-3 strength standards `deficiency.py:45` | Squat 1.0/1.5/2.0/2.5, Bench 0.6/1.0/1.4/1.8, Deadlift 1.2/1.75/2.4/3.0 ×BW | ✅ consistent with mainstream (Starting Strength / Sensai) novice→elite ratios |
| Push:pull volume 1.0–1.3 `deficiency.py:225` | coaching convention, not evidence-based | ⚠️ heuristic — label as such; harmless as advice |
| Decoupling classes `vo2max.py:372` | <5 Excellent, ≤8 Acceptable, >8 deficiency | ✅ TP's <5 % good / 5–8 % acceptable rule |
| Zone-distribution stream guard | non-finite / ≤0 dropped; `zero_is_dropout` distinguishes power (keep 0 W) vs HR (drop 0) | ✅ correct and hard-won (audit B5) |
| Encryption | Fernet (AES-128-CBC + HMAC-SHA256) | ✅ |

---

## Findings

### S1 — VO2max fitness bands are mislabelled and mis-calibrated  🔴 High

**Code**: `backend/app/services/cycling/vo2max.py:52-80`
```
VO2_CLASS_SCOPE = "general-population bands (not age/sex-adjusted)"
<35 Poor · 35-45 Below Average · 45-55 Average · 55-65 Good · 65-75 Excellent · >75 Superior
```

**Literature**: ACSM general-population males 20–29 are classified Poor <33–41,
Average ≈46–50, **Superior >46–55** depending on the edition used; the FRIEND cycle-ergometry
registry gives a **50th-percentile VO2max of 41.9 ml/kg/min for men 20–29** (women 31.0),
declining ~10 % per decade [S11†, S13].

**Verdict**: The app's "Average" (45–55) is the *population superior* band; "Superior"
requires >75, which is near-elite. Even against FRIEND cycle data the median is ~42. So the
label "general-population bands" is wrong — these are a trained-cyclist/athlete scale — and,
because they are age-unadjusted, a fit 60-year-old at 45 ml/kg/min is shown as "Below Average"
while a 25-year-old at the same value is "Average". The comment even concedes the intent
("so a 55-year-old is not judged against a 25-year-old's Average") but only *labels* the scope;
it does not fix the value shift.

**Recommendation**: Either (a) calibrate to a cited source and state it (FRIEND cycle
percentiles by age/sex), or (b) rename the bands to an athlete scale and keep the scope label.
Bands should be age- and sex-adjusted; the FRIEND paper provides the percentile tables.

> **Compounding defect**: `VO2_CLASS_SCOPE` is **never read anywhere in `backend/app/`** — the
> only consumers are `tests/test_ftp_factors.py`. `POWER_PROFILE_SCOPE`, by contrast, *is*
> surfaced (`services/charts.py:2333,2363`). So the API returns a bare `classification` string
> ("Average") with the intended caveat silently dropped. Either wire the scope into the VO2max
> response/insight or drop the constant. (See `unused-features.md`.)

---

### S2 — Climb categories claim Strava parity but use different thresholds  🔴 High

**Code**: `backend/app/services/segments.py:143-155` (mirrored in the Modal terrain worker)
```
HC  : ≥7.5% and ≥900 m gain      Cat 3: ≥4.0% and ≥100 m
Cat 1: ≥5.0% and ≥450 m          Cat 4: ≥3.0% and ≥30 m
Cat 2: ≥5.0% and ≥150 m
```

**Literature**: Strava computes `score = length_m × grade(%)`, which is exactly
`100 × elevation_gain_m`. Thresholds: Cat 4 ≥8,000, Cat 3 ≥16,000, Cat 2 ≥32,000, Cat 1 ≥64,000,
HC ≥80,000, with a single global floor of ≥3 % average gradient. In gain terms that is
**≥80 / 160 / 320 / 640 / 800 m** [S12].

**Verdict**: The app's bands are systematically more generous at the low end and inconsistent at
the top:

| Climb | App | Strava |
|-------|-----|--------|
| 150 m @ 6 % | **Cat 2** | Cat 4 (score 15,000) |
| 300 m @ 5 % | **Cat 1** | Cat 3 (score 30,000) |
| 800 m @ 5 % | Cat 1 | **HC** (score 80,000) |
| 60 m @ 4 % | **Cat 4** | unclassified (score 6,000) |

A 30 m rise is also below the app's own detection floor of interest and far below Strava's
categorisation minimum, so everyday UK ramps get Cat 4 badges that Strava never assigns. For an
app whose whole premise is importing Strava rides, users will notice the disagreement.

**Recommendation**: Implement the score (`100 × gain`, or `length × grade`) with Strava's five
thresholds and the single ≥3 % floor, and update the docstring (it currently says "Strava-style",
which readers take as "Strava-compatible"). If a gradient-weighted model is preferred, name it
as such rather than implying Strava parity.

---

### S3 — Decoupling uses mean power, not Normalized Power  🟠 Medium

**Code**: `backend/app/services/cycling/vo2max.py:433-441`
```
# "TrainingPeaks convention": mean power over mean HR
ratio_1 = mean(power_1st) / mean(hr_1st)
```
**Literature**: TrainingPeaks defines the Efficiency Factor as **NP / average HR**, and
aerobic decoupling as the change in EF between halves [S5]. The app's own comment is right that
the *ratio of half-means* (not the mean of per-sample ratios) is the convention — but the
numerator should be the half's Normalized Power, not its arithmetic mean.

**Verdict**: On steady Z2 rides NP ≈ mean and the numbers agree; on anything variable the
arithmetic mean understates the half's physiological cost, so the computed decoupling is
**smaller than TP reports** — the app is more lenient exactly when the ride is least
steady-state and the metric least valid. The `normalized_power()` helper already exists in
`tss.py`, so the fix is local.

**Recommendation**: Compute NP over each half (or reuse `compute_normalized_power` on each half's
slice) and document any deliberate deviation.

---

### S4 — Decoupling is computed without the steady-state gating it needs  🟠 Medium

**Code**: `vo2max.py:387` (single-activity path has **no duration gate**); history gate is
"rides ≥60 min with power+HR" (`compute_decoupling_history`). Only validity filters are
`power>0`, `hr>0`, ≥60 pairs, ≥30 per half.

**Literature**: Decoupling is only interpretable for a sustained, steady, *aerobic* effort —
TP requires ≥20 min at a steady aerobic effort, low variability (VI ≈ 1), and power in the lower
zones; on intervals, group rides or races the number is meaningless [S5].

**Verdict**: The app will happily emit a decoupling value for a 20-min sweet-spot interval set
or a criterium, where the metric is noise. The threshold guards (±) don't exist anywhere.

**Recommendation**: Gate the value on VI ≤ ~1.10 and a majority of classified power samples in
Z1–Z3 (or at least a "not steady — treat with caution" flag), and require ≥20–30 min on the
single-activity path.

---

### S5 — "Foster's method" is misattributed  🟠 Medium

**Code**: `backend/app/services/lifting.py:119`
```
# Foster's method: session load = tonnage × session RPE
```
**Literature**: Foster's session-RPE load is **RPE × session duration (minutes)** in arbitrary
units — the whole literature on session-RPE (Haddad 2017; Wallace 2008) multiplies *duration*,
not tonnage [S8].

**Verdict**: The implemented formula (`(tonnage/bodyweight) × RPE/10 × 1.4`) is a
bodyweight-normalised *volume-load* hybrid, not Foster's method. The code is otherwise honest
that `1.4` is a display-scale constant, but the first line of the comment sends a future
maintainer to the wrong literature and makes the formula look validated when it isn't. The
duration fallback at `lifting.py:159` (`duration_min × avg_RPE / 7`) *is* the Foster-style
estimate, which makes the mislabel more confusing.

**Recommendation**: Rename the comment to "volume-load adaptation (not Foster's session-RPE)"
and cite nothing, or explicitly note it is a bespoke metric. Foster's own method is a fine
alternative if a duration-based load is wanted.

---

### S6 — LTHR heart-rate zones are misattributed  🟠 Medium

**Code**: `zones.py:34-41`
```
LTHR_HR_ZONES = Z1 0–80 % · Z2 80–89 % · Z3 89–95 % · Z4 95–105 % · Z5 105 %+
# comment: "LTHR-based HR zones (Andy Coggan model for HR)"
```
**Literature**: Coggan's published HR zones (%LTHR) are **Z1 ≤68, Z2 69–83, Z3 84–94,
Z4 95–105, Z5 ≥106** [S7]. Friel's LTHR zones are ≈ Z1 <81, Z2 81–89, Z3 90–93, Z4 94–99,
Z5 100–105+.

**Verdict**: The app's table matches neither model — it is closest to a compressed Friel,
not to Coggan. The consequence is material at the low end: a steady endurance ride at 75 % LTHR
is **Coggan Z2** but lands in the app's **Z1**, which then inflates "Z1/Z2 percentage" in the
deficiency module's "missing intensity" flag (§3 `analyze_deficiencies`). Consumers of power
zones are unaffected (those are correctly Coggan).

**Recommendation**: Fix the attribution and either adopt Coggan's HR boundaries to match the
power zones or explicitly name the model used (Friel). Note the app's `HR_ZONES` (%HRmax) table
is already labelled "kept for reference" — the LTHR table is the live one.

---

### S7 — FRIEND citation attributes the paper to the wrong authors  🟠 Medium

**Code**: `vo2max.py:33` and `:91` — `(Nes et al., 2018, PubMed 29692203)`.

**Verdict**: PMID 29692203 is **Kokkinos P, Kaminsky LA, Arena R, Zhang J, Myers J.
(2018)**, *A new generalized cycle ergometry equation for predicting maximal oxygen uptake:
FRIEND*, Eur J Prev Cardiol 25(10):1077–1082 [S1]. There is no "Nes" author. The same file also
claims ">4× lower error" (`:34`) and "~30× more accurate" (`:47`); the primary abstract states
the ACSM error was "over 30 times" higher, while contemporary commentary quotes "four times"
[S1, S2]. The two comments contradict each other.

**Recommendation**: Correct the author to Kokkinos et al. and pick one error figure with its
source (`AGENTS.md`/`docs/algorithms.md` repeat "Nes et al. 2018" and should be fixed too).

---

### S8 — TSB is not lagged one day  🟠 Medium

**Code**: `training_load.py:70-72` — inside the daily loop, the day's TSS is applied to CTL/ATL
*then* `tsb = ctl − atl` is stored for that same day.

**Literature**: TrainingPeaks: *"The TSB value for Today is calculated from the previous day's
training"* — i.e. today's form uses yesterday's CTL and ATL [S6].

**Verdict**: The app's TSB for day *t* already contains day *t*'s training, so on a training day
it reads as an *end-of-day/post-ride* form, effectively "tomorrow's form" in TP's labelling. On
rest days the two agree. TSB drives readiness wording in the workout planner and the daily
verdict, so the morning "how fresh am I" answer is depressed by the session the user is about to
do (or has just done) rather than reflecting overnight freshness.

**Recommendation**: Either compute `tsb_t = ctl_{t-1} − atl_{t-1}` (a one-line shift) or
document loudly that the series is post-day. Given `_tsb_signal` in `health_analysis.py` also
consumes this series, changing it will move overtraining alerts and needs a test.

---

### S9 — Power-profile norms understate "trained male rider"  🟡 Low–Med

**Code**: `power_profile.py:18-24` — `5 s p50 = 10.0`, `60 min p50 = 3.0 W/kg`.

**Literature**: Coggan's category chart puts Cat 5 (untrained) at 5 s ≈12.5 W/kg and 60 min
≈2.8 W/kg, Cat 4 at ≈14.3 / 3.4, Cat 1 at ≈18.7 / 5.1 [S4]. Independent 2026 age-group
benchmarks: 2.5 W/kg recreational, 3.3 "good recreational", 3.8 strong amateur.

**Verdict**: The table's median corresponds to a *recreational* rider (between Coggan Cat 5 and
Cat 4), yet it is labelled "trained-male-rider norms". The values are internally plausible as a
percentile distribution of all riders, but their provenance is not given and the scope label
overstates the population. A user with genuine Cat-2 numbers will read as far beyond p90.

**Recommendation**: Cite the source of the percentile table, or relabel ("recreational-to-trained
male riders"). Keep the (correct) note that it is not age/sex-adjusted.

---

### S10 — FRIEND applied to 5-min power is a proxy; 8-min→5-min adds error  🟡 Low–Med

**Code**: `vo2max.py:128-162` — Method 1 uses best **5-min** power; the 8-min signal is scaled to
its 5-min equivalent via Riegel before being fed to FRIEND.

**Literature**: FRIEND was regressed on **peak work rate from a graded maximal cycle test**
(ramp to exhaustion, typically ~10 min), not on a 5-minute maximal effort [S1].

**Verdict**: 5-min best power is a reasonable stand-in, but it is systematically higher than the
peak of a graded ramp, so the estimate is biased high; converting an 8-min read through a
running-derived power law adds a second layer of approximation on top of it. The 20–90 sanity
gate catches only gross failures. This is defensible as a field estimate provided it is labelled
as one.

**Recommendation**: Note the proxy in user-facing copy ("field estimate from 5-min power"), and
consider lower confidence on the Riegel-derived 8-min branch (already 0.5).

---

### S11 — Gut-training carb-ratio direction is inverted  🟡 Low–Med

**Code**: `nutrition.py:45-50` — *"Intakes above 90 g/h require … a fructose:glucose ratio of
about 1:2 (e.g. ~30 g fructose + ~60 g glucose per hour)."*

**Literature**: A **2:1 glucose:fructose** ratio (i.e. fructose:glucose 1:2) is the best-studied
blend **up to ~90 g/h**; to go *above* 90 g/h the evidence favours **more** fructose
(≈1:0.8 glucose:fructose, i.e. fructose:glucose ≈1:1.25) [S14].

**Verdict**: The "multiple transportable carbohydrates + gut training" advice is right; the
specific ratio is the one for *at or below* 90 g/h, applied to the one regime where it is not
the recommendation. The `MAX_CARBS_PER_HOUR = 90` cap itself is correct and well-justified.

**Recommendation**: Split the note: "up to 90 g/h: 2:1 glucose:fructose; above 90 g/h
(gut-trained): shift toward 1:0.8."

---

### S12 — Optimal CTL ramp band is at the aggressive end  🟡 Low

**Code**: `docs/algorithms.md:35` / ramp-rate chart — "optimal build +3 to +8 CTL/wk, >8 risky".

**Literature**: Common guidance is a *safe* ramp of ~3–5 CTL/wk, with 7–8 as the upper limit and
"sharply raises risk" beyond it [S15].

**Verdict**: "+8 as optimal" presents the ceiling as a target. Not wrong, but the copy should
distinguish safe from maximal. Low impact — it is a labelled band on a chart.

---

### S13 — Health composites are unvalidated heuristics with inconsistent thresholds  🟡 Low

**Code**: `health_analysis.py` — overtraining = TSB 40 % + recovery 35 % + HRV 15 % + sleep 10 %;
injury = volume-spike 55 % + rest-days 45 %; illness = 25/20/25/15/15 %. `_tsb_signal` treats
`TSB < −35` as the overreaching trigger, while `adaptive.py` cuts load at `TSB ≤ −20`.

**Literature**: No validated multi-signal index underpins these weights; the volume-spike half is
an ACWR/EWMA construct, which is itself contested [S16].

**Verdict**: Fine as "signals worth surfacing", unsafe as a stated risk score. The −35 vs −20
split across two modules is a consistency smell — the same athlete can be "recovering from
overtraining" by one engine and "raise the load"… no, cut, by the other, at the same TSB band
(adaptive cuts at ≤−20, health flags <−35), which at least errs the same direction, but the
numbers should be reconciled or the divergence documented.

**Recommendation**: Label the scores as heuristics in the UI/API; unify the TSB cut threshold or
add a comment explaining why the two differ. Guard against multiple-comparison over-reading of
the OLS weather/sleep correlations (already R²-gated ≥0.1, which helps).

---

### S14 — Adaptive CTL/ATL time-constant fitting is non-standard  🟡 Low

**Code**: `integrations/power_models.py` — grid-search τ_CTL (21–63) and τ_ATL (3–14) to
maximise the correlation between TSB and next-day HRV; persist only with ≥45 samples and
R² ≥ 0.10.

**Literature**: Standard PMC uses fixed 42/7; personalising τ is an active research area without
a single accepted method [S6]. Correlating TSB with HRV assumes HRV is a clean
fatigue/readiness proxy, which is only partly true.

**Verdict**: Defensible *because* it is gated (n and R²) and surfaced via
`training_load_for_user(include_meta=True)`. Present the fitted τ as an experiment, not a
correction.

---

## Test impact of the proposed fixes

| Fix | Tests that must change |
|-----|------------------------|
| S2 climb categories | `tests/test_segments.py::test_climb_category_bands` **asserts the current non-Strava bands**; `tests/test_route_intelligence.py::test_climb_category_matches_canonical` asserts the Modal worker mirrors `services.segments.climb_category` — both halves must move together or the mirror test fails. |
| S1 / S9 relabelling | `tests/test_ftp_factors.py:133-142` asserts `VO2_CLASS_SCOPE` contains "not age/sex-adjusted" (and the power-profile equivalent). Relabelling is safe if that phrase is kept. |
| S3 decoupling → NP | `tests/test_cycling.py:150-169` only exercises constant-power streams (where NP = mean), so switching the numerator to NP should not break it; add a variable-power case. |
| S8 TSB lag | `_tsb_signal` in `health_analysis.py` and the workout-planner readiness copy both consume the series — a one-day shift will move alert/readiness outputs. Needs its own test and a changelog note. |

## Related, already-known issues (cross-referenced, not re-opened)

- `ActivityStream.resolution` is `NULL` for every Strava stream, so the `resolution or 1`
  weighting in `zones.py:108,187` silently treats every sample as 1 s. For 1 Hz watts/HR
  streams this is harmless *in percentage terms*, but `time_seconds` fields are mis-scaled for
  any decimated stream. (`segments.py` was fixed in the earlier audit B4; the zone paths were
  not.)
- Decoupling splits by *sample count* (`mid = len(valid_pairs)//2`), not elapsed time; with
  dropouts the two halves are not equal-duration.
- `projections.tsb_projection()` still uses the simplified `TSS/42` and `TSS/7` divisors rather
  than the exponential EWMA used everywhere else — quantified as <1 CTL point over 14 days
  (`docs/algorithms.md:26`).

---

## Sources

- **[S1]** Kokkinos P, Kaminsky LA, Arena R, Zhang J, Myers J. *A new generalized cycle
  ergometry equation for predicting maximal oxygen uptake: FRIEND.* Eur J Prev Cardiol.
  2018;25(10):1077–1082. DOI 10.1177/2047487318772667 · PMID 29692203.
- **[S2]** *Maximal oxygen uptake: New and more accurate predictive equation* (editorial),
  Eur J Prev Cardiol 2018. DOI 10.1177/2047487318780442 (the "four times lower" wording).
- **[S3]** Uth N, Sørensen H, Overgaard K, Pedersen PK. *Estimation of V̇O2max from the ratio
  between HRmax and HRrest — the Heart Rate Ratio Method.* Eur J Appl Physiol. 2004;91:111–115.
  PMID 14624296 (validated in **well-trained men**).
- **[S4]** Allen H, Coggan A. *Training and Racing with a Power Meter* — power profile category
  chart (5 s / 1 min / 5 min / FTP W/kg by racing category).
- **[S5]** TrainingPeaks — *Aerobic Decoupling (Pw:Hr / Pa:Hr) and Efficiency Factor (EF)*:
  EF = NP ÷ average HR; decoupling <5 % good, 5–8 % acceptable.
- **[S6]** TrainingPeaks — *Form (TSB)*: today's TSB is computed from the previous day's
  training. *Performance Management Chart* (CTL/ATL, τ = 42/7).
- **[S7]** Coggan HR zones (%LTHR): Z1 ≤68, Z2 69–83, Z3 84–94, Z4 95–105, Z5 ≥106.
- **[S8]** Foster C et al. session-RPE: load (AU) = RPE × duration (min). Review: Haddad M et al.
  *Session-RPE Method for Training Load Monitoring.* Sports Med. 2017. PMC5673663.
- **[S9]** Brzycki 1RM = load × 36/(37−reps), reliable for ≤10 reps (Macarilla 2022; DiStasio).
- **[S10]** Morton RH. *A 3-parameter critical power model.* Eur J Appl Physiol. 1996.
  PMID 8854981.
- **[S11]** González-Badillo / Lake et al. minimal-velocity thresholds: squat ≈0.30 m/s,
  bench ≈0.15 m/s, deadlift ≈0.15 m/s.
- **[S12]** Strava — *How does Strava categorize climbs?*: score = length(m) × grade(%)
  = 100 × gain(m); thresholds 8k / 16k / 32k / 64k / 80k; ≥3 % grade floor.
- **[S13]** Kaminsky LA et al. *Reference Standards for Cardiorespiratory Fitness … Cycle
  Ergometry (FRIEND).* Mayo Clin Proc. 2016;92(2):228–233 (50th percentile cycle VO2max).
- **[S14]** Glucose:fructose ratios — 2:1 up to 90 g/h; 1:0.8 toward/above 120 g/h
  (Jeukendrup; Podlogar 2022, PMC9560939).
- **[S15]** Friel J. *The CTL Ramp Rate*; consensus safe ramp ≈3–5 CTL/wk.
- **[S16]** Gabbett TJ. Acute:chronic workload ratio — contested in later meta-analyses.
