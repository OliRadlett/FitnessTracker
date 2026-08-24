---
description: Run ruff lint and format on the backend code.
---

Run ruff lint with auto-fix on the backend:

```
ruff check backend/ --fix
```

Then run ruff format on the backend:

```
ruff format backend/
```

Report any remaining issues. If all clean, confirm the backend code passes linting.
