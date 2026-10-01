# Design Spec — Section 7: Live-Session Flush Liveness (the one set that wedges the workout)

> **Date**: 2026-10-01 · **Type**: bug fix (data integrity / liveness) · **Surface**: `useLiveSession` flush engine, live lifting tracker
>
> **Origin**: brainstorm `plans/brainstorm-2026-09-30-open-agenda.md` inventory item
> "offline writes". **Re-baselined: the feature is already shipped, and it is the most
> hardened code in the repository.** `useLiveSession.ts` is 731 lines with a dedicated test
> suite, `mergeWithStorage` handling mid-flush mutation/cross-tab/discard races, `live_key` +
> `client_id` server-side idempotency, localStorage durability, `resumeSession` rebuild,
> and four explicit 404-tolerances. The gap is not offline support.
>
> **The gap is liveness in the failure path.** One set that fails deterministically wedges
> every later set, every queued delete, and the session finish — forever, across reloads.
>
> Plan-mode draft — relocate to repo `plans/` + commit on build mode.

## 1. Problem

### 1.0 The offline story is built

Worth stating precisely, because it changes the shape of the fix. Already present:

| Capability | Site |
|---|---|
| localStorage durability across reload / app kill | `useLiveSession.ts:66-89,147-158` |
| Per-set `client_id` + per-session `live_key`, server-side idempotent | `:455`, `:484`; `services/lifting.py:260-269,563-572` |
| `navigator.onLine` tracked **separately** from API failure | `:195-215` (the distinction that lets the UI promise "logging locally") |
| Reconnect + foreground replay | `:427-438` |
| Queued deletes with 404-treated-as-done | `:319-331` |
| `mergeWithStorage` — mid-flush mutation, cross-tab, discard-mid-flush, replace-mid-flush, undo-racing-sync | `:105-145` |
| `resumeSession` — rebuild from server when localStorage is lost | `:624-653` |
| Wall-clock `endedAt` captured at *request* time so a delayed retry records the true end | `:596-598` |
| Durable `finish_requested` flag so a pre-Finish flush still completes | `:81-84,337` |
| Capped backoff (8 s) plus a 4 s finish-retry effect | `:400`, `:661-670` |
| Dedicated tests incl. legacy-state backfill | `__tests__/live-session-sync.test.tsx` |

Do not rebuild any of this. The fix is narrow.

### 1.1 A single failing set aborts the entire flush

`useLiveSession.ts:305-316`:

```js
const unsynced = working.sets.filter((s) => !s.remoteId);
for (const set of unsynced) {
  try {
    const remote = await addSetToSession(authFetchRef.current, working.sessionId!, toPayload(set));
    ...
  } catch {
    throw new Error('add-set-failed');   // ← any error aborts the WHOLE flush
  }
}
```

The inner `catch` swallows the actual error and rethrows a string, which lands in the outer
`catch` (`:387`) → `setSyncError(true)` → `followUpFlush(8000)`.

Consequences, all permanent:

- **Every set after the failing one never syncs.**
- **Every queued delete never drains** — Step 3 is below Step 2 and is never reached.
- **Step 4's finish PATCH never runs**, so `phase: 'finishing'` never resolves.
- For a finishing session the 4 s effect (`:661-670`) retries **forever**, re-pushing
  already-synced sets as no-op requests on every pass. Unbounded request amplification
  against the user's own backend, every 4 seconds, indefinitely.

Already-synced sets are safe (each is `commit()`ed at `:312`), so this is a liveness bug
rather than data loss — until §1.3.

### 1.2 The asymmetry that proves it's a bug, not a design choice

Steps 3 and 4 **both** handle 404 explicitly and treat it as terminal-but-done:

- `:326` — a set already deleted elsewhere returns 404; "treat it as done so a stale id can
  never wedge the queue".
- `:364` — the remote session was deleted while a finish was queued; "treat the finish as
  done instead of retrying a 404 forever (**which wedged START behind the overlay**)".

That second comment describes **this exact bug, already hit once, already fixed — in the
wrong step.** The same reasoning applies verbatim to Step 2 and was never applied there. So
the author knew 404s were expected and hardened two of three steps.

The correct Step-2 response to a 404 is also different from Step 4's: the remote session is
gone, so clear `working.sessionId` and let Step 1 re-create. Re-creation is **safe by
construction** — `create_session` is idempotent on `live_key` and posts all unsynced sets in
the same call (`:280-287`), so the sets land on the new session.

### 1.3 A deterministically-invalid set wedges the workout across reloads

This is what makes §1.1 severe rather than theoretical. `LiftingSetCreate.weight_kg: float`
is required and non-nullable (`schemas/lifting.py:14`). A mistyped weight field — a stray
letter in an otherwise-valid number — produces `NaN`, and `JSON.stringify` serialises `NaN`
as `null`. Pydantic rejects it: **422, deterministically, forever.**

*(Confirm the exact path in a test — a letter in the weight input — rather than trusting this
chain of reasoning. The structural finding in §1.1 holds regardless of which error triggers
it; this is the most reachable trigger, not the only one.)*

What makes it unrecoverable rather than merely annoying:

- The set is persisted to localStorage (`:147-158`), so **the poison survives a reload**.
- `saveState`'s `catch` is empty — storage failure is swallowed — but here storage *succeeds*;
  the bad value is faithfully persisted.
- The finishing overlay offers `retrySync` (`:615-617`), which calls `flush()` — which fails
  **identically**. The one control the user has cannot help.
- The UI cannot even identify the culprit: `pendingCount` (`:693-695`) is a bare count with no
  per-set sync state, so the user sees "3 pending" with no way to tell which set is stuck.
- Sets already synced are safe, but any set logged **after** the bad one is local-only.

Net: a single typo in a weight field can cost the user the back half of a workout, with no
in-app path to recovery short of manually deleting the offending set from a list that does
not mark it.

### 1.4 `set_number` drifts across a resume

`resumeSession` adopts server `set_number` verbatim (`:631`), but `logSet` (`:497`) and
`nextSetNumberFor` (`:679-683`) derive the next number from `count + 1`. Because
`set_number` has no enforced per-exercise contiguity (Section 6 §1.3 — sessions can hold
1, 1, 3), a resumed session continues at `count + 1` rather than `max + 1`, silently
skipping numbers.

Low severity on its own, and **fixed by Section 6 §2.3** rather than here. Recorded because
it is a second live consumer of a column whose semantics are currently undefined.

## 2. Design

### 2.1 Distinguish transient from permanent failures

Stop collapsing every error into one string. Classify in Step 2's `catch`:

- **Transient** (network, 5xx, 429, 408) → rethrow as today; the backoff handles it.
- **4xx that will never succeed** (400, 422) → mark **this set** failed, skip it, continue.
- **404 on the session** → clear `sessionId` so Step 1 re-creates on the next pass, then
  continue. Not a set-level failure at all.

This is the change that makes the flush total rather than abort-on-first-problem.

### 2.2 Dead-letter with a visible signal

A dead-lettered set is not dropped silently — that would be a worse version of the current
bug, trading a loud wedge for quiet data loss. Instead:

- Track `failedReason` per set in `LiveSessionState`, persisted alongside it.
- Surface it: `pendingCount` becomes `pendingCount + failedCount`, and `syncStatus` gains a
  `'blocked'` state when any set is dead-lettered, distinct from `'error'` (server
  unreachable) and `'offline'` (browser offline).
- The finishing overlay must offer **"remove this set and finish"** for each dead-lettered
  set. That is the recovery affordance §1.3 says is missing — it turns an unrecoverable
  wedge into a two-click recovery while preserving every other set in the session.
- Include the exercise name and reason in the message ("Bench Press — weight was not a
  number"), so the user knows which field to fix rather than which row to blame.

### 2.3 Bound the retry loop

Cap attempts per set (`attempts: number` on `LoggedSet`) and stop the 4 s finish effect from
running unbounded once every remaining item is either synced or dead-lettered. Today the
effect fires on `finishing` alone, with no termination condition. With §2.1 in place the loop
naturally terminates; the cap is belt-and-braces against a genuinely flapping server.

### 2.4 Fix `set_number` on resume

Take `max + 1` rather than `count + 1` in both `logSet` (`:497`) and `nextSetNumberFor`
(`:679-683`). Two characters, correct against non-contiguous existing data, and it stops
depending on the invariant Section 6 is still establishing. Both call sites share the same
expression — extract it once so they cannot drift.

### 2.5 Validate before persisting

Cheap, and it removes the most reachable trigger rather than handling it downstream: reject
a non-finite `weight_kg`/`reps` at `logSet` entry, before the set enters state or storage.
Surface it inline on the input. Defence in depth — §2.1/§2.2 still apply to every other
poison shape.

## 3. Traps

### 3.1 Do not solve §1.1 by swallowing errors

The tempting minimal patch is `catch { /* skip */ }`. That converts a loud wedge into
**silent, permanent data loss** — sets that never sync and never warn. §2.2's visible
dead-letter signal is what distinguishes a fix from a regression.

### 3.2 Re-creating the session must stay idempotent

§1.2's 404 handler clears `sessionId`, which re-enters Step 1. That is only safe because
`create_session` collapses on `live_key` (`services/lifting.py:260-269`). If `live_key` were
ever absent (a `resumeSession`-built state assigns a **fresh** one at `:641`, while
`sessionId` is set so Step 1 is skipped — but a 404 would clear `sessionId` and re-enter
Step 1 with that fresh key), each re-creation would mint a **new** session and orphan the
old one. Verify the interaction: on a 404, reuse the **existing** `liveKey` rather than
minting a new one, so re-creation collapses instead of duplicating.

### 3.3 `commit()` returning false must still abort

`commit()` returns `false` when the session was discarded or replaced mid-flush
(`:302,312,330`). Those `return`s are correct and must not be converted into the
skip-and-continue behaviour of §2.1 — a discarded session must stop syncing immediately.
Distinguish "abort because the session is gone" from "skip this set" by return value, not
by exception type.

### 3.4 Don't touch the `mergeWithStorage` semantics

It is subtle, correct, and load-bearing (`B2`/`B4` markers in comments). §2.1–§2.3 add state
fields; they must not alter the merge's precedence rules (sync progress wins for
`remoteId`; user data wins from storage).

## 4. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Dead-lettering hides a transient error that would have succeeded | §2.1 classifies on status code; only 400/422 are permanent. Transient classes still throw |
| Re-create on 404 orphans the previous session | §3.2 — reuse the existing `liveKey` so re-creation is idempotent |
| Visible "blocked" state alarms users over a rare condition | Better than silent loss. Blocked is visually distinct from `error`/`offline` and resolves in two clicks |
| Skipping a set changes session volume silently | The dead-letter signal names the set; §2.2's removal action re-syncs state so volume is recomputed on the next read |
| `NaN` may not be the actual trigger | §1.3 flags it for test confirmation; the §1.1 structural fix is independent of which status code triggers it |

## 5. Testing

- **§1.1 regression (core)**: a 3-set queue where the middle set 422s → the other two sync,
  the middle is dead-lettered, and **Step 4 still runs**. Assert the session finishes.
- **§1.2**: `add_set` returns 404 → `sessionId` is cleared, the next pass re-creates the
  session via the **same `liveKey`** (`:641`/`resumeSession` case), and all sets land on one
  session — assert no second `LiftingSession` row exists.
- **§1.3**: log a set with `weight_kg: NaN` → rejected at `logSet` with an inline message,
  never persisted, never reaching the queue. Then force a 422 through a different route and
  assert dead-letter + the "remove and finish" affordance.
- **§2.3**: a finishing session where every set is synced or dead-lettered stops the 4 s
  effect — assert the timer does not reschedule.
- **§3.2**: three consecutive 404s produce exactly one `LiftingSession`.
- **§3.3**: discard mid-flush still aborts immediately; it does **not** dead-letter or skip.
- **§2.4**: resuming a session whose server `set_number`s are 1, 1, 3 continues at 4.
- Extend `__tests__/live-session-sync.test.tsx` rather than adding a parallel suite — it
  already covers the mid-flush races this must not regress.

## 6. Defers (explicit)

- **Offline reads / cached dashboards.** localStorage is for the live session only; every
  page still requires the network. A real offline story needs a query cache with persistence,
  which is a React Query configuration change and a separate decision about staleness.
- **Background Sync / service-worker replay.** The `online` + `visibilitychange` triggers
  (`:427-438`) cover the realistic cases. A service-worker queue would add a second,
  invisible queue to reason about for no practical gain here.
- **Cross-device live-session handoff.** `resumeSession` rebuilds from the server, which is
  the right primitive, but two devices logging into one session concurrently is not modelled.
- **Manual-set editing UI.** Named repeatedly across sections; still undefinable without
  deciding what a correct restore means (relates to undo, deferred in Section 6 §6).

## 7. AGENTS pitfalls honored

- **10** — ServiceWorker must not cache API responses; §6 keeps API calls network-only and
  does not extend the runtime cache.
- **11** — `enabled: !!token` discipline unchanged; the live hook takes `authFetch` through
  the ref at `:221-222` so a refreshed token is picked up mid-session. Preserved.
- **14** — no new backend model; §2.4 touches client code only, so no migration is needed
  for the primary fix. (Section 6 §2.2 adds the migration separately.)
- **23** — backend changes run host-side from `backend/` with `python -m pytest tests/ -q`;
  frontend tests via the existing Vitest suite.
- **Rule 13/14 (verify before destructive writes)** — `useLiveSession.ts` is 731 lines of
  heavily-reasoned concurrency code with in-place `B2`/`B4` bug fixes. Changes are additive
  state fields plus one error-classification block; the merge semantics are untouched (§3.4).