---
description: Trigger a database backup.
---

Trigger a database backup:

```
python fittrack.py exec backend python -c "from app.tasks.backup import backup_database; backup_database.delay()"
```

If that fails, try direct pg_dump:

```
python fittrack.py exec backend pg_dump -U fittrack fittrack > backups/backup_$(Get-Date -Format 'yyyyMMdd_HHmmss').sql
```

Report the backup location and status.
