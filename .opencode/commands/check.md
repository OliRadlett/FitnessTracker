---
description: Quick health check — verify backend starts and responds.
---

Run a quick health check on the FitTrack backend:

1. Check if services are running:

```
python fittrack.py exec backend python -c "from app.main import app; print('FastAPI app loaded OK')"
```

2. Check database connection:

```
python fittrack.py exec backend python -c "from app.database import engine; import asyncio; asyncio.run(engine.connect()); print('DB connection OK')"
```

3. Check backend logs for errors:

```
python fittrack.py logs backend --tail 20
```

Report the status of each check.
