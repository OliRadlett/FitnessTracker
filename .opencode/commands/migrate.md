---
description: Create and apply an Alembic database migration.
---

Create a new Alembic migration with the description provided in $ARGUMENTS, then
review, apply, and verify it.

Before generating, check `git status` and inspect `origin/main` for revision
number collisions. Do not edit an applied migration.

First, generate the migration:

```
python fittrack.py exec backend alembic revision --autogenerate -m "$ARGUMENTS"
```

Read the generated file and check its `revision` and `down_revision` headers.

Then apply the migration:

```
python fittrack.py migrate
```

After applying, verify the migration is at head:

```
python fittrack.py exec backend alembic current
```

Then run the disposable-database upgrade and downgrade/upgrade contract from
`docs/RUNNING.md`. Report the migration revision and every check that ran.
