import { describe, expect, it } from 'vitest';
import {
  EMPTY_FACETS,
  activeFacetCount,
  decodePolyline,
  elevationGeometry,
  elevationValues,
  facetsFromParams,
  facetsToParams,
  facetsToQuery,
  findHub,
  formatClimb,
  formatDuration,
  formatKm,
  haversineKm,
  providerChain,
  shapeGeometry,
  sortRoutes,
} from '@/lib/routeAtlas';
import type { RouteSummary } from '@/lib/api/types';

// 0.02° square at 51.5N, and a 2°x1° box for the aspect check.
const SQUARE = '_riyH~oR?_|B_|B??~{B~{B?';
const WIDE = '_riyH~hbE?_seK_ibE??~reK~hbE?';
const TWO_POINTS = '_riyH~oR_pR~oR';

function route(partial: Partial<RouteSummary> & { id: string }): RouteSummary {
  return {
    name: partial.id,
    sport_type: 'cycling',
    distance_meters: 20_000,
    start_lat: 51.5,
    start_lng: -0.1,
    end_lat: 51.5,
    end_lng: -0.1,
    is_loop: true,
    is_favorite: false,
    sources: [{ id: 's1', provider: 'strava', provider_route_id: 'p', provider_name: 'n', encoded_polyline: '', synced_at: '' }],
    tags: [],
    ride_count: 0,
    is_ridden: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...partial,
  } as RouteSummary;
}

describe('decodePolyline', () => {
  it('decodes a known encoded shape', () => {
    const points = decodePolyline(SQUARE);
    expect(points).toHaveLength(5);
    expect(points[0][0]).toBeCloseTo(51.5, 4);
    expect(points[0][1]).toBeCloseTo(-0.1, 4);
  });

  it('returns nothing for missing input', () => {
    expect(decodePolyline(null)).toEqual([]);
    expect(decodePolyline('')).toEqual([]);
  });
});

describe('shapeGeometry', () => {
  it('projects a route into the box and keeps it inside it', () => {
    const geometry = shapeGeometry(SQUARE, 100, 60, 6);
    expect(geometry.usable).toBe(true);
    expect(geometry.path.startsWith('M')).toBe(true);
    for (const point of geometry.points) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(100);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(60);
    }
  });

  it('preserves the geographic aspect instead of stretching', () => {
    const geometry = shapeGeometry(WIDE, 200, 200, 0);
    const xs = geometry.points.map((p) => p.x);
    const ys = geometry.points.map((p) => p.y);
    const ratio = (Math.max(...xs) - Math.min(...xs)) / (Math.max(...ys) - Math.min(...ys));
    // 2° of longitude at 51.5N is ~1.24x one degree of latitude.
    expect(ratio).toBeGreaterThan(1.1);
    expect(ratio).toBeLessThan(1.4);
  });

  it('reports a route with fewer than three points as unusable', () => {
    expect(shapeGeometry(TWO_POINTS, 100, 60).usable).toBe(false);
    expect(shapeGeometry(null, 100, 60).usable).toBe(false);
  });
});

describe('elevation', () => {
  it('reads both stored profile shapes', () => {
    expect(elevationValues({ elevations: [1, 2, 3] })).toEqual([1, 2, 3]);
    expect(elevationValues({ distance: [0, 1], elevation: [10, 20] })).toEqual([10, 20]);
    expect(elevationValues(null)).toEqual([]);
  });

  it('drops nulls and refuses a profile with too few points', () => {
    expect(elevationValues({ elevations: [1, null, 3] })).toEqual([1, 3]);
    expect(elevationGeometry({ elevations: [1, 2] }, 100, 40).usable).toBe(false);
    expect(elevationGeometry({ elevations: [10, 20, 30, 40] }, 100, 40).usable).toBe(true);
  });
});

describe('facetsToQuery', () => {
  it('maps bands onto the endpoint min/max contract', () => {
    expect(facetsToQuery({ ...EMPTY_FACETS, distance: 'medium' }, 'nearest')).toMatchObject({
      min_distance: 40_000,
      max_distance: 80_000,
      sort_by: 'created_at',
    });
    expect(facetsToQuery({ ...EMPTY_FACETS, climb: 'big' }, 'nearest')).toMatchObject({
      min_elevation: 900,
    });
    expect(facetsToQuery({ ...EMPTY_FACETS, status: 'unridden' }, 'nearest')).toMatchObject({
      is_ridden: false,
    });
    expect(facetsToQuery({ ...EMPTY_FACETS, shape: 'loop' }, 'nearest')).toMatchObject({
      is_loop: true,
    });
    expect(facetsToQuery({ ...EMPTY_FACETS, sport: 'hiking' }, 'nearest')).toMatchObject({
      sport_type: 'hiking',
    });
  });

  it('maps sorts onto endpoint fields', () => {
    expect(facetsToQuery(EMPTY_FACETS, 'distance').sort_by).toBe('distance');
    expect(facetsToQuery(EMPTY_FACETS, 'climb').sort_by).toBe('elevation');
    expect(facetsToQuery(EMPTY_FACETS, 'ridden').sort_by).toBe('ride_count');
  });

  it('counts only active facets', () => {
    expect(activeFacetCount(EMPTY_FACETS)).toBe(0);
    expect(activeFacetCount({ ...EMPTY_FACETS, distance: 'long', status: 'ridden' })).toBe(2);
  });
});

describe('facet URL state', () => {
  it('omits defaults so a plain library has a plain URL', () => {
    expect(facetsToParams(EMPTY_FACETS, 'nearest')).toEqual({
      q: null,
      dist: null,
      climb: null,
      status: null,
      shape: null,
      sport: null,
      sort: null,
    });
  });

  it('round-trips every facet and the sort', () => {
    const facets = {
      ...EMPTY_FACETS,
      q: 'gravel loop',
      distance: 'long' as const,
      climb: 'big' as const,
      status: 'unridden' as const,
      shape: 'loop' as const,
      sport: 'cycling',
    };
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(facetsToParams(facets, 'climb'))) {
      if (value) params.set(key, value);
    }
    expect(facetsFromParams(`?${params.toString()}`)).toEqual({
      facets,
      sort: 'climb',
    });
  });

  it('degrades unknown values to the defaults instead of throwing', () => {
    const parsed = facetsFromParams('?dist=impossible&climb=steep&sort=nope&shape=round');
    expect(parsed.facets.distance).toBe('any');
    expect(parsed.facets.climb).toBe('any');
    expect(parsed.facets.shape).toBe('any');
    expect(parsed.sort).toBe('nearest');
  });
});

describe('geo helpers', () => {
  it('measures known distances', () => {
    // London to Edinburgh, ~534 km.
    expect(haversineKm(51.5074, -0.1278, 55.9533, -3.1883)).toBeGreaterThan(520);
    expect(haversineKm(51.5074, -0.1278, 55.9533, -3.1883)).toBeLessThan(545);
  });

  it('finds the dense start cluster', () => {
    const hub = findHub([
      route({ id: 'a', start_lat: 51.5, start_lng: -0.1 }),
      route({ id: 'b', start_lat: 51.51, start_lng: -0.11 }),
      route({ id: 'c', start_lat: 51.52, start_lng: -0.12 }),
      route({ id: 'd', start_lat: 46.2, start_lng: 6.1 }),
    ]);
    expect(hub?.count).toBe(3);
  });

  it('sorts nearest from the hub', () => {
    const near = route({ id: 'near', start_lat: 51.5, start_lng: -0.1 });
    const far = route({ id: 'far', start_lat: 55.95, start_lng: -3.19 });
    const sorted = sortRoutes([far, near], 'nearest', { lat: 51.5, lng: -0.1 });
    expect(sorted[0].id).toBe('near');
  });
});

describe('formatting', () => {
  it('formats distance, climb and duration', () => {
    expect(formatKm(64_900)).toBe('64.9 km');
    expect(formatKm(120_000)).toBe('120 km');
    expect(formatClimb(1392)).toBe('1,392 m');
    expect(formatClimb(null)).toBe('—');
    expect(formatDuration(9_900)).toBe('2h 45m');
    expect(formatDuration(600)).toBe('10m');
  });

  it('deduplicates the provider chain', () => {
    const routeWithSources = route({
      id: 'x',
      sources: [
        { id: '1', provider: 'strava', provider_route_id: 'a', provider_name: 'a', encoded_polyline: '', synced_at: '' },
        { id: '2', provider: 'strava', provider_route_id: 'b', provider_name: 'b', encoded_polyline: '', synced_at: '' },
        { id: '3', provider: 'komoot', provider_route_id: 'c', provider_name: 'c', encoded_polyline: '', synced_at: '' },
      ],
    });
    expect(providerChain(routeWithSources)).toBe('strava ×2 + komoot');
  });
});
