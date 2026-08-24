---
description: Interactive guide to add a new frontend page.
---

Add a new frontend page to FitTrack.

Ask the user for:
1. Page name (e.g., "nutrition", "body-composition")
2. Route path (e.g., "/nutrition")
3. Brief description of what the page will show

Then follow these steps:

## Step 1: Create the page file

Create `frontend/src/app/(app)/$ROUTE/page.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'

export default function PageName() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Page Name</h1>
      {/* Page content */}
    </div>
  )
}
```

## Step 2: Add nav item

Add to `frontend/src/components/Sidebar.tsx` navigation array:

```tsx
{ name: 'Page Name', href: '/route', icon: IconComponent }
```

Use an appropriate icon from `lucide-react`.

## Step 3: Create API client (if needed)

Create `frontend/src/lib/api/yourDomain.ts` with typed fetch functions using `useAuthFetch`.

Add barrel export in `frontend/src/lib/api/index.ts`.

## Step 4: Verify

Confirm the page builds: check for TypeScript errors in the created file.

Reference: `frontend/src/CODEMAP.md` for patterns.
