---
description: Run backend and frontend tests.
---

Run the FitTrack test suite.

## Backend Tests

```
python fittrack.py exec backend pytest backend/tests/ -v --tb=short
```

If no tests directory exists, report that and skip.

## Frontend Tests

Run from the frontend directory (use the `workdir` parameter in OpenCode bash, not `cd`):

```
npm run test -- --run
```

If the `test` script doesn't exist in package.json, report that and skip.

Report pass/fail counts for each suite. If all pass, confirm. If any fail, show the failure details.
