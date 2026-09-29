# Archived Plans

> Historical planning documents from August 2026. These described features that
> have since been **implemented and significantly evolved**. Many reference file
> paths that no longer exist (e.g. `frontend/src/lib/api.ts` was split into
> `lib/api/{module}.ts` files; `backend/app/services/strava.py` was moved to
> `backend/app/services/strava/sync.py`).

## What was archived (33 files)

Phase plans (1–7, 5.2), audits, investigations, and design docs from the
initial project bootstrap. See `docs/archive/` for audit snapshots.

## Still-referenced content

- **Modal expansion**: superseded by `docs/algorithms.md` (Modal Intelligence Platform section) and `backend/app/integrations/` CODEMAP.
- **3D ride view enhancements**: superseded by `plans/relive-3d-redesign.md`.
- **Audit changelog**: historical — current bug tracking is in `docs/BUGS.md`.

## Accessing old content

All archived content is available in git history:
```bash
git log --oneline --all -- plans/archive/
```
