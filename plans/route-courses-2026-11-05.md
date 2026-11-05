# Route courses — production plan (Course → Route → Ride)

> Status: **migrations 107 + 108, course service/API and the `/courses` surface
> implemented on `feature/route-courses`; not deployed.** The API is
> `GET/POST /api/v1/courses`, `GET /uncoursed`, `GET /suggestions` (review-tier
> pairs from `route_similarity`), group/ungroup under
> `/{course_id}/routes/{route_id}`, merge `/{target_id}/merge/{source_id}`,
> `PATCH /{course_id}` (rename), dismiss/restore a suggestion at
> `/suggestions/{a}/{b}/dismiss`, and confirm/reject at
> `/ride-links/{activity_id}/...`. The UI is
> `frontend/src/app/(app)/courses/` (nav: More → Courses) and caps the course
> list at 12 (filter + Show all 86) because the 1:1 backfill yields 86 one-route
> courses. This plan is the production hand-off for the investigation in
> `prototype/route-merging/` (main worktree, not merged).

## 1. Why

The current `Route` row carries two identities: the **course** ("the same
circuit / roads") and the **route variant** (the concrete geometry, direction,
start point, detour, provider source). Merging two variants has to delete one
row, which loses the variant's geometry and provider history. The review queue
cannot express "same course, different route".

The investigation found:

- 86 real routes; 11 cached similarity pairs, all `review`, scores 0.566–0.698,
  all with `frechet_similarity = 0`.
- When the shape term is 0, the maximum score is 0.75, below the 0.82 auto
  threshold: auto-tier is unreachable for real loops.
- The same 54.1 km loop, rotated 5 % around its start, scores 0.645 (review)
  with coverage 1.000. The shape term collapses; the score is coverage plus
  endpoint.
- The 11 pairs contain four course families with 2–4 variants (11 routes → 4
  courses); the other two pairs are different routes sharing a corridor.
- Existing ride→route links came from a WIP matcher and are not trusted.

The model decision is **Course → Route → Ride**: one course owns many route
variants; one route has many rides.

## 2. Schema

### `courses` (new)

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | UUID PK | no | |
| `user_id` | UUID FK users CASCADE | no | indexed |
| `name` | String(500) | no | duplicates allowed |
| `sport_type` | String(50) | no | default `cycling` |
| `canonical_route_id` | UUID FK routes SET NULL | yes | unique when not null |
| `identity_source` | String(20) | no | `legacy`/`manual`/`provider`/`matcher` |
| `identity_confidence` | Float | yes | |
| `created_at`, `updated_at` | timestamptz | no | |

### `routes` (additive)

- `course_id` UUID FK `courses.id` `ON DELETE SET NULL`, nullable, indexed.
- `NULL` = uncoursed. The FK is SET NULL, not CASCADE: deleting a course must
  never delete its routes or rides.

### `course_link_log` (new)

Non-destructive group/ungroup audit: `user_id`, `course_id`, `route_id`,
`action` (`group`/`ungroup`), `previous_course_id`, `score`, `breakdown`,
`created_at`, `undone_at`. `RouteMergeLog` remains for destructive merges.

### `activities` (additive)

- `route_link_status` (`suggested`/`confirmed`/`rejected`; NULL = unclassified)
- `route_link_source` (`legacy`/`provider`/`matcher`/`manual`)
- `route_link_confidence` (Float)
- `route_link_confirmed_at` (timestamptz)
- Check: `route_link_status IS NULL OR route_id IS NOT NULL`.

## 3. Migrations

### 107 — `courses` + `routes.course_id` + `course_link_log`

- Additive only.
- Backfill **1:1**: one course per existing route, `identity_source='legacy'`,
  `canonical_route_id=route.id`, `routes.course_id=course.id`.
- Idempotent (`WHERE r.course_id IS NULL` + `NOT EXISTS` guard).
- Does **not** group variants, delete routes, or touch activities.
- Down: drop the log, the FK/column, the table. Safe before grouping; after
  grouping, export `course_link_log` first.

### 108 — ride-link trust

- Add the four `activities` columns.
- Backfill every existing `route_id IS NOT NULL` as
  `route_link_status='suggested'`, `route_link_source='legacy'`.
- Never promotes a link to `confirmed`.
- Down: drop the constraint and columns; `activities.route_id` is untouched.

### 109 — durable suggestion dismissals

- New `course_suggestion_dismissals`: `user_id`, `route_a_id`, `route_b_id`,
  `created_at`; unique per user/ordered pair; `a <> b` check.
- The similarity cache is rebuilt on every scan, so a "not the same course"
  decision cannot live on `route_similarity`. This table survives rebuilds and
  the suggestion query skips both orientations.
- `POST/DELETE /courses/suggestions/{a}/{b}/dismiss` persists/undoes it.
- Down: drop the table. Dismissals are lost, but routes/courses are untouched.

## 4. Merge semantics

| Operation | Behaviour |
|---|---|
| Group a variant | `UPDATE routes SET course_id = :course`; `course_link_log` row; no delete. |
| Ungroup | `UPDATE routes SET course_id = NULL`; log row. |
| Merge identical variants | Existing `merge_routes`, scoped to the same course; `RouteMergeLog`. |
| Merge two courses | Group all routes of B under A, then archive/delete the empty course; log each route. |
| Delete a course | Routes become uncoursed (`SET NULL`); never cascade. |
| Delete a route | If canonical, `courses.canonical_route_id` becomes NULL. |

## 5. Read rules (important)

- Course history, PRs and "ridden" counts read **`confirmed` links only**.
- `suggested` links may appear on route detail with a badge.
- `NULL` link status is unclassified, not confirmed.
- The matcher may propose (`source='matcher'`, `confidence=<score>`), never
  confirm.
- Existing links are `legacy` suggestions; do not use them to rank courses or
  compute PRs until reviewed.

## 6. Rollout

1. **Branch:** `feature/route-courses` from `origin/main` (106).
2. **Local:** apply 107/108 to a throwaway DB, verify the backfill counts and
   the check constraint (done: 1 route → 1 course; activity → suggested/legacy;
   bad link status rejected).
3. **CI:** backend tests + migration chain test (`tests/test_course_schema.py`).
4. **Staging:** apply 107/108 to a copy of prod; verify 108 routes → 108 courses,
   every route has a course, no duplicate `canonical_route_id`, existing
   activities all `suggested`/`legacy`.
5. **Prod:** apply 107/108 in the normal Deploy. No behavior change: the routes
   API/UI do not read `course_id` yet.
6. **Follow-up (separate):** course API, grouping review UI, confirmed-link
   review, course history/PRs.

## 6b. Matcher follow-up — start-invariant loops

The course suggestions exposed the matcher ceiling from the investigation:
discrete Fréchet is index-aligned, so a loop recorded from a different point
lost its shape score. Fixed in `services/route_matching.py`:

- `_align_loop_start()` rotates a loop candidate onto the reference loop's start
  (nearest of three candidates) before Fréchet; point-to-point is untouched.
- `_endpoint_similarity()` returns 1.0 for loop-vs-loop, because a loop's start
  is arbitrary. Point-to-point still requires both ends to converge.

The real 54.1 km loop now scores 0.960/auto at 5% and 10% offsets and 0.946/auto
at 25%, versus 0.645/0.600/0.600. Reversed loops are still rejected. The 11
cached pairs remain review-band because they are different variants sharing
roads, not exact rotations; precision did not regress. This changes scores only
after the similarity cache is rebuilt.

## 7. Quality gate

- `alembic upgrade head` then `downgrade 106` then `upgrade head` on a
  throwaway DB.
- `routes` count = `courses` count after 107 (for the backfilled population);
  every route has `course_id`; zero duplicate `canonical_route_id`.
- A route can be canonical for one course only; a second attempt is refused.
- 108: existing links are `suggested` + `legacy`; course history reads
  `confirmed` only; the check constraint rejects a status without a route.
- `pytest tests/test_course_schema.py -q` passes.
- No route/activity is deleted or rewritten.

## 8. Open questions (before API/UI)

1. Course-level tags/collections/quality — stay route-level for now.
2. Course deletion — archive vs delete when the last route is removed.
3. Canonical route — user-selected, with a default suggestion.
4. Uncoursed routes — allowed and surfaced in Maintain.
5. UI naming — Course / Route / Ride vs Route / Variant / Ride.
6. Legacy Komoot groups — separate cleanup, not part of 107.

## 9. Evidence

The investigation, contact sheet, start-offset table and the 86 → 79 audit are
in `prototype/route-merging/` on the main worktree:

- `DIAGNOSIS.md`
- `SPIKE-ROUTE-COURSE.md`
- `SCHEMA-PLAN.md`
- `DECISIONS.md` D11–D17
- `qa/out/cached-pairs.png`, `qa/out/start-offset.txt`
- `qa/model_audit.py`

They are intentionally not merged; the lab is deletable in one commit.

## 10. Files changed by this plan

- `backend/app/models/route.py` — `Course`, `CourseLinkLog`, `Route.course_id`.
- `backend/app/models/activity.py` — link-trust columns + check.
- `backend/app/models/__init__.py` — register both models.
- `backend/app/services/course_service.py` — list/get/group/ungroup, link trust.
- `backend/app/schemas/course.py` — course schemas.
- `backend/app/api/courses.py` + `backend/app/main.py` — `/api/v1/courses`.
- `backend/alembic/versions/107_add_courses_and_route_course_id.py`
- `backend/alembic/versions/108_add_activity_route_link_trust.py`
- `backend/alembic/versions/109_add_course_suggestion_dismissals.py`
- `backend/tests/test_course_schema.py`
- `backend/tests/integration/test_courses_api.py`
- `frontend/src/app/(app)/courses/page.tsx`
- `frontend/src/lib/api/courses.ts`, `types/courses.ts`, barrels
- `frontend/src/components/Sidebar/MoreDrawer.tsx` — Courses nav entry
- `backend/app/models/CODEMAP.md`, `backend/app/api/CODEMAP.md`,
  `backend/app/services/CODEMAP.md`, `backend/app/schemas/CODEMAP.md`,
  `frontend/src/CODEMAP.md`, `frontend/src/lib/api/CODEMAP.md`, `AGENTS.md` —
  docs.
