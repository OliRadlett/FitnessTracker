---
description: Check status of all Docker services.
---

Check the health of all FitTrack services:

```
python fittrack.py status
```

If that doesn't work, fall back to:

```
docker compose ps
```

Report which services are running, stopped, or unhealthy. Include uptime if available.
