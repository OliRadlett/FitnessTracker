---
description: Create and apply an Alembic database migration.
---

Create a new Alembic migration with the description provided in $ARGUMENTS, then apply it.

First, generate the migration:

```
python fittrack.py exec backend alembic revision --autogenerate -m "$ARGUMENTS"
```

Then apply the migration:

```
python fittrack.py migrate
```

After applying, verify the migration is at head:

```
python fittrack.py exec backend alembic current
```

Report the migration revision and any issues.
