---
description: Run backend and frontend tests.
---

Run source-tree verification. Do not use container pytest unless the image was
rebuilt after the current changes.

## Backend Tests

```
python scripts/verify.py --all
```

If no tests directory exists, report that and skip.

The local command does not run the disposable-database migration contract, API
contract CI job, or Playwright CI job. Report those as unverified, not passed.
If a migration changed, run the disposable-database migration contract
described in `docs/RUNNING.md` before reporting the work as verified.
