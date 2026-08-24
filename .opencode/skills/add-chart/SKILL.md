---
name: add-chart
description: Use when adding a new chart to the FitTrack dashboard. Covers backend ChartService, CHART_REGISTRY, frontend Chart component, and data format.
---

# Add Chart

Step-by-step guide for adding a new chart visualization to FitTrack.

## Architecture

Backend registry → ChartService → Frontend Recharts wrapper.

## Files to Create/Modify

### 1. Backend Chart Service (`backend/app/services/charts.py`)

Add a new method to `ChartService`:

```python
async def get_your_chart(self, db: AsyncSession, user_id: UUID, **filters) -> ChartData:
    # Query data from DB
    # Transform into ChartData format
    pass
```

### 2. Register in CHART_REGISTRY (`backend/app/api/charts.py`)

Add to the registry dict:

```python
CHART_REGISTRY = {
    # ... existing charts ...
    "your_chart_name": {
        "service_method": "get_your_chart",
        "description": "Description of what the chart shows",
        "default_params": {},
    },
}
```

### 3. ChartData Format

```python
from dataclasses import dataclass
from typing import List, Optional

@dataclass
class ChartData:
    title: str
    chart_type: str  # "line", "bar", "scatter", "area", "pie"
    x_label: str
    y_label: str
    datasets: List[ChartDataset]
    reference_areas: Optional[List[ReferenceArea]] = None

@dataclass
class ChartDataset:
    name: str
    data: List[dict]  # [{"x": value, "y": value}, ...]
    color: str
```

### 4. Frontend (usually no changes needed)

The generic `Chart` component at `frontend/src/components/charts/Chart.tsx` renders any `ChartData` from the backend. Just call the endpoint and pass data to `<Chart>`.

### 5. API Endpoint

Add to `backend/app/api/charts.py` or call from existing endpoint:

```python
@router.get("/charts/{chart_name}")
async def get_chart(chart_name: str, ...):
    # CHART_REGISTRY lookup + service call
    pass
```

## Existing Chart Types

| Type | Use For |
|------|---------|
| `line` | Time series (TSS, HRV, weight trends) |
| `bar` | Distributions (HR zones, power zones) |
| `scatter` | Correlations (power vs HR) |
| `area` | Stacked data (training load) |
| `pie` | Proportions (sport breakdown) |

## Reference Areas

Add zone coloring:

```python
reference_areas = [
    ReferenceArea(x_start=0, x_end=50, color="green", label="Zone 1"),
    ReferenceArea(x_start=50, x_end=100, color="yellow", label="Zone 2"),
]
```

## Pitfalls

1. **Backend returns ChartData** — frontend just renders it, no data transformation on client
2. **Query keys** — if chart is filterable, include filters in React Query key
3. **Performance** — for large datasets, aggregate on backend before returning
