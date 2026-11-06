# FitTrack Bug Report — Active Bugs

> **Updated**: 2026-11-06 | **Open: 2** (BUG-045 deferred, BUG-099 open) |
> **Archived: 61** (see `BUGS-archive.md` and git history).
>
> Bug IDs are identifiers, not a count: they are non-contiguous (014–044 and
> others were never filed). BUG-013 and BUG-015 were fixed long ago and are no
> longer listed. BUG-025, BUG-048 and BUG-068 were verified fixed on
> 2026-11-06 and moved to the archive.

## Open Bugs

### BUG-045: Live Secrets in Working Directory `.env`
- **Status:** DEFERRED (manual rotation required)
- **File:** `.env`
- **Issue:** Contains real credentials: Komoot password, Gemini API key, SECRET_KEY, NEXTAUTH_SECRET. While gitignored, this file should never contain production credentials on a shared machine.
- **Fix:** Rotate all exposed credentials immediately. Use a secrets manager or only store credentials on the production server.

### BUG-099: Adaptive Rest-Day Advice Carries No Apply Action
- **Status:** OPEN (the emission is guarded; the fix needs a product call)
- **File:** `backend/app/services/adaptive.py` (`generate_adaptive_suggestions`)
- **Issue:** The `rest_day` suggestion's actions are attached inside `if factor is not None and upcoming:`, but `rest_day` is emitted only when recovery is below `RECOVERY_LOW`, and that same low recovery suppresses the load axis, which is the only source of an `intensity_cut` / `intensity_raise` suggestion. So `factor` is always `None` whenever a rest day is advised, and the loop that fills `actions` never runs — both cards (`AdaptiveSuggestionsCard`, `TodayAdaptiveAction`) show rest advice with no button. The action was live for one day after it landed (2026-09-08) and stopped when the load axis gained its `not recovery_low` gate (`904d267`, 2026-09-09). No test covered it, so nothing went red.
- **Fix:** Hoist the rest loop out of the `factor` gate so rest advice carries actions, and decide there whether it offers one action or one per upcoming day (the suggestion's own detail says "the next non-rest session"). The hoist must also re-add the guard the dead path carried: a date holding more than one session gets no rest action, because the action's intent is to rest a *day* and the apply endpoint would refuse it with a 409 (`update_plan_day` finds the other session and raises `PlanDayConflictError`). That guard was removed along with the rest of the unreachable path, so nothing re-adds it for you.
