# Routes Page Redesign Plan

> **Status**: In Progress
> **Phases**: 1-4 (see implementation timeline below)
> **Goal**: Transform routes page from passive list → active route intelligence hub

## Vision

Current routes page is a passive list with basic detail view. Users with 50–200 routes can't efficiently organize, discover, plan, or act on their routes. Redesign transforms it into a **route intelligence hub** — browse, organize, analyze, plan, and ride.

## Scope

- Frontend: page + components + state management
- Backend: new endpoints, models, services
- Database: new tables/columns

## Removed Features

- **Calendar Planner (Feature F)**: The training plan page already handles ride scheduling. No calendar view on this page.

## Clarification Decisions

1. **Effort Estimation**: Use existing `CyclingProfile.ftp` from user settings. If not set, prompt user to configure.
2. **Weather**: Extend existing `CachedWeather` + Open-Meteo service. Add route-specific endpoint sampling start/mid/end coords.

## Information Architecture

### Primary Views (all first-class, switchable)

| View | Purpose | Best For |
|------|---------|----------|
| **Map Browse** (default) | Visual discovery, spatial filtering, ride planning | "Where should I ride today?" |
| **List/Table** | Dense data, bulk actions, sorting, exporting | Power users, cleanup sessions |
| **Grid/Cards** | Visual scanning, quick compare, touch-friendly | Mobile, casual browsing |

### Route Detail (slide-over panel)

- Opens on click from any view
- Tabs: Overview → Map & Profile → History → Weather → Effort → Activities
- Persistent URL deep-link (`?route=<id>`)

## Organization: Tags + Smart Collections (NOT hierarchical folders)

### Recommendation: Flat Tags with Smart Collections

| Aspect | Tags (Manual) | Smart Collections (Auto) |
|--------|---------------|--------------------------|
| Mental model | Gmail labels / Spotify tags | Apple Music playlists / saved searches |
| Route in multiple | Yes | Yes (by rule) |
| Nesting | No | No (but groupable) |
| Auto-populate | Hard | Native (rules-based) |
| Mobile UI | Chips (great) | Chips |

### Data Model

```sql
-- User-defined tags
CREATE TABLE route_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(7),  -- hex
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (user_id, name)
);

-- Many-to-many
CREATE TABLE route_taggings (
    route_id UUID REFERENCES routes(id) ON DELETE CASCADE,
    tag_id UUID REFERENCES route_tags(id) ON DELETE CASCADE,
    PRIMARY KEY (route_id, tag_id)
);

-- Smart/manual collections
CREATE TABLE route_collections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    icon VARCHAR(50),
    color VARCHAR(7),
    is_smart BOOLEAN DEFAULT false,
    rules JSONB,  -- e.g. {"surface": ["gravel", "dirt"], "min_distance_km": 50}
    sort_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Manual collection membership (for non-smart)
CREATE TABLE route_collection_items (
    collection_id UUID REFERENCES route_collections(id) ON DELETE CASCADE,
    route_id UUID REFERENCES routes(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (collection_id, route_id)
);
```

### UI Patterns

- Sidebar: **Smart Collections** (auto) + **My Tags** (manual chips)
- Smart collections: "Unridden Routes", "Gravel > 50km", "Local Loops", "Race Courses", "High Quality (≥80)"
- Click tag/chip → filters list/map instantly
- Drag route onto tag → assigns tag
- "Create smart collection from current filters" button

## Route Intelligence Features

### A. Route Quality Score

- Nightly Celery task computes for all user routes
- Factors:
  - Data completeness (30%): has elevation, surface, time estimate
  - Popularity (20%): ride count
  - Surface quality (25%): paved % vs technical
  - Effort match (25%): how well estimated effort matches user FTP zones
- Displayed as colored ring/badge on cards, sortable

### B. Effort Estimation

- Input: user FTP (from `CyclingProfile`), weight, bike type (road/gravel/MTB), target intensity (zone)
- Output: estimated time, TSS, IF, NP, kcal
- Model: modified Martin cycling power model + surface CRR adjustments
- Shown in detail panel + list "Est. @ FTP" column

### C. Weather Integration

- Extend existing `CachedWeather` + Open-Meteo
- Route-specific: sample start/end/midpoint coordinates
- Show: current conditions, wind direction on map, "best day to ride" suggestion
- Cache per route location (rounded to 0.1°) for 3 hours

### D. Duplicate Manager

- Dedicated route: `/routes/duplicates`
- List pairs with score, side-by-side mini-map preview
- Actions: merge (keep A/B), dismiss, auto-merge high-confidence
- Uses existing `/duplicates` endpoint + new bulk `/merge`

## Backend API Extensions

### New Endpoints (`app/api/routes.py`)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/tags` | GET/POST | List/create tags |
| `/tags/{id}` | PATCH/DELETE | Update/delete tag |
| `/collections` | GET/POST | List/create collections |
| `/collections/{id}` | PATCH/DELETE | Update/delete collection |
| `/collections/{id}/routes` | POST/DELETE | Add/remove routes |
| `/collections/from-filters` | POST | Create smart collection from current filters |
| `/quality/recompute` | POST | Trigger quality recompute (manual) |
| `/duplicates/auto-merge` | POST | Auto-merge high-confidence duplicates |
| `/bulk/export-gpx` | POST | Download multiple routes as ZIP |

### Enhanced List Endpoint

- Add `tag_ids`, `collection_id`, `is_favorite`, `min_quality_score` filters
- Return tags, collections, quality_score in RouteSummary

## Frontend Architecture

### Component Structure

```
src/app/(app)/routes/
├── page.tsx                    # Main page, view router, state
├── components/
│   ├── RoutesMapView.tsx       # Map-first browse (enhanced MapBrowseView)
│   ├── RoutesListView.tsx      # Virtualized list/table
│   ├── RoutesGridView.tsx      # Card grid for mobile/visual
│   ├── RouteDetailPanel.tsx    # Slide-over detail (replaces right pane)
│   ├── RouteTagSidebar.tsx     # Collapsible tag/collection tree
│   ├── RouteFilterBar.tsx      # Unified filter toolbar
│   ├── RouteQualityBadge.tsx   # Visual quality indicator
│   ├── RouteEffortEstimate.tsx # Power-based time estimate
│   ├── RouteWeatherCard.tsx    # Forecast for route location
│   ├── DuplicateManager.tsx    # Review/merge UI
│   └── RouteBulkActions.tsx    # Floating bar when multi-selected
```

### State Management (React Query + Zustand)

```typescript
interface RoutesState {
  viewMode: 'map' | 'list' | 'grid';
  selectedRouteId: string | null;
  selectedRouteIds: Set<string>;
  activeCollectionId: string | null;
  activeTagIds: string[];
  filters: RouteFilters;
  compareIds: [string, string] | null;
}
```

## Mobile-First Responsive

| Breakpoint | Map | List | Grid | Detail |
|------------|-----|------|------|--------|
| < 640px | Full-screen, bottom sheet detail | Hidden | Default | Bottom sheet |
| 640-1024 | Split 50/50 | Available | Available | Slide-over (400px) |
| > 1024 | Default | Default | Available | Slide-over (480px) |

## Implementation Phases

### Phase 1: Foundation (Week 1-2)

Database migrations: `route_tags`, `route_taggings`, `route_collections`, `route_collection_items`, `route_quality`
Backend: tag/collection CRUD, quality service, enhanced list endpoint
Frontend: Zustand store, view router (Map/List/Grid), unified filter bar
Frontend: Virtualized list (tanstack-virtual), grid view, map view refactor

### Phase 2: Core Intelligence (Week 2-3)

Quality scoring algorithm + nightly Celery task
Effort estimation service (Martin model, uses CyclingProfile.ftp)
Weather integration for routes (extend CachedWeather service)
Detail panel: Overview, Map, Profile, History, Weather, Effort tabs

### Phase 3: Organization (Week 3-4)

Sidebar: Smart Collections + My Tags
Tag chips in filter bar + route cards
Drag-drop tagging (dnd-kit)
"Create smart collection from filters" wizard
Duplicate manager page (`/routes/duplicates`)
Bulk actions: export GPX zip, multi-tag, multi-delete

### Phase 4: Polish & Mobile (Week 4-5)

Mobile bottom sheets, swipe gestures, touch-optimized
Keyboard shortcuts (/, f, n, m, g, esc)
Empty states, onboarding tooltips, feature discovery
Performance: infinite scroll, route thumbnail preload
Tests: Vitest (components), Playwright (critical flows)

## Open Technical Decisions

| Decision | Options | Recommendation |
|----------|---------|----------------|
| Effort model complexity | Simple vs Physics-based | Physics (Martin) — uses FTP meaningfully |
| Quality score weights | Hardcoded | Hardcoded v1, expose config v2 |
| Smart collection rules UI | JSON editor vs Visual builder | Visual builder |
| Map clustering | Leaflet.markercluster vs custom | Leaflet.markercluster |
| Route thumbnails | On-demand vs pre-render | On-demand with caching |

## Success Metrics

| Metric | Target |
|--------|--------|
| Time to find a route | < 10s |
| Routes with quality score | 100% within 24h of sync |
| Tag/collection adoption | > 70% of users with > 20 routes |
| Smart collection usage | > 50% of filtered views |
| Duplicate merge rate | > 80% of high-confidence pairs |

## Rollback Safety

All changes are additive. Feature flags (`NEXT_PUBLIC_ROUTES_V2`) can gate new UI. Old page accessible at `/routes/legacy` during transition.
