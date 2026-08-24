---
description: Interactive guide to add a new API endpoint.
---

Add a new API endpoint to FitTrack.

Ask the user for:
1. Endpoint name (e.g., "nutrition", "body-composition")
2. HTTP method (GET, POST, PUT, DELETE)
3. Brief description of what it does
4. Whether it needs a database model

Then follow these steps:

## Step 1: Create the route handler

Add to `backend/app/api/yourResource.py`:

```python
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.services.auth import get_current_user

router = APIRouter()

@router.get("/your-endpoint")
async def your_endpoint(
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user),
):
    # Call service
    pass
```

## Step 2: Create the service function

Add to `backend/app/services/yourService.py`:

```python
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession

async def your_function(db: AsyncSession, user_id: UUID, ...):
    # Business logic
    pass
```

## Step 3: Create Pydantic schema (if needed)

Add to `backend/app/schemas/yourSchema.py`:

```python
from pydantic import BaseModel

class YourResponse(BaseModel):
    model_config = {"from_attributes": True}
    # Fields
```

## Step 4: Register router

Add the router to `backend/app/api/__init__.py` or the main app.

## Step 5: Run linting

```
ruff check backend/app/api/yourResource.py --fix
ruff format backend/app/api/yourResource.py
```

Reference: `backend/app/api/CODEMAP.md`, `backend/app/services/CODEMAP.md` for patterns.
