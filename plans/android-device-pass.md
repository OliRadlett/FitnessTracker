# Android device pass

> **Status**: complete — the device pass ran; see `android-lifting-parity.md`.

The last clause of the parity objective is *"on device test at the end of
development"*. Every feature below is already covered by JVM tests
(`gradle :app:testDebugUnitTest`, 174 tests) — this pass is about the things a
JVM cannot see: real network against prod, real taps, real layout on a 360×804
screen, and what the phone does when the signal goes.

Device used for the earlier passes: **OnePlus 11 (CPH2449)**, 1080×2412 @480dpi
= **360×804 dp**, over wireless adb.

## Preconditions

```powershell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
# Wireless debugging must be on, and the phone unlocked.
& $adb devices                       # one device, no "unauthorized"
& $adb shell dumpsys window | Select-String 'mDreamingLockscreen'   # false
```

Install the build under test:

```powershell
cd android
gradle :app:assembleDebug
& $adb -s <serial> install -r app\build\outputs\apk\debug\app-debug.apk
```

Sign in first: **You → Continue with Google**. Every section below except "Today
(rest day)" needs a token.

## Capture

Screenshots are pulled, never streamed — `adb exec-out > x.png` corrupts PNGs in
PowerShell.

```powershell
function Shot($name) {
  & $adb -s <serial> shell screencap -p /sdcard/p.png
  & $adb -s <serial> pull /sdcard/p.png "qa/$name.png"
  & $adb -s <serial> shell rm /sdcard/p.png
}
```

Tap coordinates come from `uiautomator dump`, **not** from eyeballing the
screenshot — the earlier pass learned that the hard way (the Start button was
~200 px lower than it looked):

```powershell
& $adb -s <serial> shell uiautomator dump /sdcard/ui.xml
& $adb -s <serial> pull /sdcard/ui.xml qa/ui.xml
# then read bounds="[x1,y1][x2,y2]" for the node with the text you want
```

## 1. Today — the plan and the verdict

- [ ] Header is **the plan's own focus** ("Push day." / "Legs.") or **"Rest
      day."** — never the seeded push day. On a rest day: "Nothing planned today
      in <plan name>." and a **Start anyway** button.
- [ ] The **verdict card** sits above the plan card: the server's headline, up
      to three reasons, `TSB n · recovery n%`. A silent engine reads
      "unavailable", never missing.
- [ ] Signed out: no verdict card at all, and the plan falls back to
      `SeedPlan` (the local push day) with the plan **Edit** button visible.
- Shots: `today-plan`, `today-verdict`, `today-rest`.

## 2. Week — reading and starting

- [ ] Train → **Week** shows the plan's current week: seven-ish day rows with
      spot/focus and `completed / partial / missed / rest`, today marked.
- [ ] `‹` and `›` page the week; the number and dates change; **"This week"**
      appears once paged away and returns to today's week.
- [ ] Paging past either end of the plan stays on a real week (no empty screen,
      no 422 in logcat).
- [ ] Tapping a strength day **starts that session** (Live opens on its first
      exercise, with last time's load). A rest/ride day does not respond.
- [ ] Starting is refused while another session is in progress.
- Shots: `week`, `week-paged`, `week-started`.

## 3. Live — the instrument

- [ ] Warm-ups action lists saved templates (`<name> · N steps · a–b kg`); one
      tap logs them as `W1..Wn` and the plan stays on set 1.
- [ ] "Save these N warm-ups as a template" adds the ramp you just did; `×`
      deletes a template.
- [ ] Log a set: prefill, plate caption, RPE pill, warm-up/AMRAP flags, rest
      card with `−30s` / `+30s`.
- Shots: `live`, `live-warmups`, `live-rest`.

## 4. Done — the summary

- [ ] Volume, sets, duration, top set.
- [ ] **NEW RECORD** block when a lift beats its history (first time counts;
      equal does not; warm-ups/bodyweight never).
- [ ] Session RPE + note saved, and both appear on the finished session.
- Shots: `done`, `done-records`.

## 5. Train → Sessions — the log

- [ ] Weeks, counts and volumes sum from the sets (not the server's
      `total_volume_kg`, which can be stale).
- [ ] Filters: text, FOCUS, EXERCISE, TYPE and CLASS. Type/Class appear only
      when the account's sessions carry classifier labels.
- [ ] Open a session: labels chips, linked Strava activity (or **Link a Strava
      activity** with real candidates), AI analysis (cached text, then "Run
      again"), set editing, `+ Set`, `+ Add exercise`, "Repeat this session".
- Shots: `log`, `log-filters`, `detail`, `detail-link`, `detail-analysis`.

## 6. Train → Progress — records, analytics

- [ ] **RECORDS**: one row per lift, `manual` badge on typed-in ones, `+ Add`
      saves a record (and it is still there after a restart).
- [ ] Personal bests, best by rep range, e1RM line.
- [ ] **VOLUME · 8 WEEKS** bars with the window total, **BALANCE** shares,
      **MOST TRAINED**.
- Shots: `progress`, `progress-records`, `progress-analytics`.

## 7. Body

- [ ] Latest weigh-in, 30-day change, **7-day average** line.
- [ ] Save a weight → it appears in WEIGH-INS and the average moves. Weighing
      twice in one day replaces rather than duplicates.
- [ ] `×` deletes a manual entry only; a scale-sourced row has no `×`.
- Shots: `body`, `body-after-log`.

## 8. Resilience

- [ ] Airplane mode → log a set → finish → the session stays pending and goes up
      on the next sync (check the website).
- [ ] Kill the app mid-session → relaunch → the session resumes with its sets.
- [ ] Sign out → plan reverts to `SeedPlan`, records/analytics/verdict/weight
      disappear rather than going stale.

# Pass 2 — the pages added after the first pass

The first pass covered the lifting matrix. Everything below was merged
afterwards and has **only** been seen at 360×804 in Robolectric, never against
prod. Same preconditions and capture commands as above.

## 9. Today — the dashboard (#460)

- [ ] **LOAD** card: CTL/ATL/TSB, the form in words, the 7-day change, and a CTL
      line that is not flat (a flat line means the history is too short, not a
      bug — say which).
- [ ] **THIS WEEK** (lifts, volume, rides, km, TSS) and the 28-day line agree with
      Train › Progress and Ride.
- [ ] **TODAY SO FAR** appears only when something has been done today.
- [ ] **READINESS**: with Whoop connected, score/HRV/RHR; without, the server's
      own "no data" sentence rather than a zero.
- [ ] **GOALS**: three active, and tapping the card opens the goals page.
- [ ] **RECENT**: the last four, lifts and rides merged newest-first.
- Shots: `p2-today-load`, `p2-today-goals`.

## 10. Ride — the cycling page (#461)

- [ ] Seven-day tiles match the website's cycling page, including the trend
      arrows (↑/↓ only where the server sends one).
- [ ] **POWER**: 5s/1min/5min/20min/60min, plus CP/W'/Pmax when the model has
      fitted. A missing duration is absent, not zero.
- [ ] **TIME IN ZONES · 30 DAYS**: percentages add up to ~100.
- [ ] **FITNESS**: FTP, the change since the first entry, and VO2max.
- [ ] The time tile shows a decimal (`3.4h`), not `3h` — that was a real fix.
- Shots: `p2-ride`, `p2-ride-mid`.

## 11. Goals (#462)

- [ ] You → **Goals**: every goal, active first, progress **from the starting
      value** (92 → 80 kg at 88.9 reads 25.8%, not 111%).
- [ ] Check in a value → the percentage moves, the check-in appears, and the
      dashboard's GOALS card agrees.
- [ ] Create a goal: the chips offer only metrics the phone can fill in — `Squat`
      is absent because it wants an exercise name.
- [ ] Mark achieved → the chip appears and the goal drops below active ones.
- [ ] Delete a goal you created for the test.
- Shots: `p2-goals`, `p2-goals-expanded`, `p2-goals-new`.

## 12. Routes (#463)

- [ ] You → **Routes**: real 90-point shapes, not the 3-point fixture — a loop
      reads as a loop.
- [ ] Filters narrow the list (Loops / Unridden / Favourites).
- [ ] Tapping a route adds locality, loop vs point-to-point, surface, quality and
      favourite state.
- [ ] A route with no `preview_polyline` shows the placeholder rather than a
      broken line.
- Shots: `p2-routes`, `p2-routes-open`.

## 13. Train → Week → edit a day (#464)

- [ ] A day row carries `edit`; tapping it opens the day as written (focus,
      exercises with sets/reps/kg, notes).
- [ ] Change the focus and save → the week row updates, and Today's plan changes
      if it is today.
- [ ] Add an exercise, remove another, save → the server's `planned_exercises`
      reflect it (check the website).
- [ ] Switch a day to **Rest** → the exercise list disappears from the editor and
      the week shows Rest.
- [ ] A refused edit (a sport clash on a date that already holds that sport) shows
      the server's sentence above the button and **does not** pop the screen.
- [ ] Cancel: leave without saving → nothing changed on the website.
- Shots: `p2-plan-day`, `p2-plan-day-saved`.

## 14. Health and calendar (#465)

- [ ] You → **Health**: recovery, sleep debt, sleep timing (score, spread,
      average bedtime), breathing described against its baseline.
- [ ] The recovery numbers match the dashboard's readiness card exactly.
- [ ] You → **Calendar**: the current month with lift dots, ride dots and a
      recovery tint; `‹ This month ›` pages and reloads.
- [ ] A day with a session opens with its entries and recovery/sleep/HRV/RHR.
- [ ] A metrics-only day (recovery, no activity) still draws a tinted cell.
- Shots: `p2-health`, `p2-calendar`, `p2-calendar-day`.

## 15. What "done" means here

The pass is done when every box above is either ticked or explained, the
screenshots exist under `qa/`, and anything written to prod during it has been
removed. Record the result in `plans/android-lifting-parity.md` (P20 for the
first pass, P28 for this one), including what failed and the fix that followed.

## Cleanup after the pass

Anything written to prod during the pass must be removed or corrected:

- [ ] Warm-up templates created by "Save these…" — delete them.
- [ ] A weigh-in logged for testing — delete it (Body → `×`).
- [ ] An activity linked by mistake — **Unlink**.
- [ ] A session started and abandoned — finish it with no sets (it is discarded)
      or delete it from the detail screen.
- [ ] A goal created for the goals test — delete it.
- [ ] A plan day edited for the plan test — restore its original focus,
      exercises and notes.


## Recording the result

Append a short note to `plans/android-lifting-parity.md` under P20 with: what
passed, what failed, and the fix that followed. The previous pass found two bugs
no JVM test could (a one-off exercise as the Progress default, and `Legs` vs
`Legs ` splitting the log) — expect this one to find something, and write it
down rather than patching silently.
