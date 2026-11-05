/**
 * Pure helpers for the routes atlas: shape projection, elevation, facets,
 * distance/sort. No React, no Leaflet — unit-tested in
 * `src/__tests__/route-atlas.test.ts`.
 */

import type { RouteData, RouteFilters, RouteSummary } from './api/types';

export type FacetValue<T extends string> = T | 'any';

export interface Facets {
  q: string;
  distance: 'any' | 'short' | 'medium' | 'long';
  climb: 'any' | 'flat' | 'rolling' | 'big';
  status: 'any' | 'ridden' | 'unridden';
  shape: 'any' | 'loop' | 'point';
  sport: string;
}

export type SortKey = 'nearest' | 'recent' | 'distance' | 'climb' | 'ridden';

export const EMPTY_FACETS: Facets = {
  q: '',
  distance: 'any',
  climb: 'any',
  status: 'any',
  shape: 'any',
  sport: 'any',
};

type Profile = RouteData['elevation_profile'] | null | undefined;

/** Google encoded polyline -> [lat, lng]. */
export function decodePolyline(encoded: string | null | undefined): [number, number][] {
  if (!encoded) return [];
  const out: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    for (const axis of [0, 1] as const) {
      let result = 0;
      let shift = 0;
      let byte = 0x20;
      while (byte >= 0x20) {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      }
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta;
      else lng += delta;
    }
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}

export interface ShapePoint {
  x: number;
  y: number;
}

export interface ShapeGeometry {
  path: string;
  points: ShapePoint[];
  start: ShapePoint | null;
  end: ShapePoint | null;
  usable: boolean;
}

/**
 * Project a route into a fixed viewBox, preserving its shape (latitude scale
 * corrected by cos(midLat)) rather than stretching to fill the box.
 */
export function shapeGeometry(
  encoded: string | null | undefined,
  width: number,
  height: number,
  pad = 6,
): ShapeGeometry {
  const coords = decodePolyline(encoded);
  const empty: ShapeGeometry = { path: '', points: [], start: null, end: null, usable: false };
  if (coords.length < 3) return empty;

  const midLat = coords.reduce((sum, [lat]) => sum + lat, 0) / coords.length;
  const kx = Math.cos((midLat * Math.PI) / 180);
  const projected = coords.map(([lat, lng]) => [lng * kx, lat] as const);
  const xs = projected.map(([x]) => x);
  const ys = projected.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 1e-9);
  const spanY = Math.max(maxY - minY, 1e-9);
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;

  const points = projected.map(([x, y]) => ({
    x: offsetX + (x - minX) * scale,
    // SVG y grows downwards; north should be up.
    y: height - (offsetY + (y - minY) * scale),
  }));

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(' ');

  return {
    path,
    points,
    start: points[0],
    end: points[points.length - 1],
    usable: true,
  };
}

/**
 * Elevation values, whichever of the two stored shapes the route carries.
 * (`{elevations}` legacy, `{distance, elevation}` canonical.)
 */
export function elevationValues(profile: Profile): number[] {
  const raw = profile?.elevations ?? profile?.elevation ?? [];
  return raw.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
}

export function hasElevation(profile: Profile): boolean {
  return elevationValues(profile).length >= 4;
}

export interface ElevationGeometry {
  line: string;
  area: string;
  min: number;
  max: number;
  usable: boolean;
}

export function elevationGeometry(
  profile: Profile,
  width: number,
  height: number,
): ElevationGeometry {
  const elevations = elevationValues(profile);
  if (elevations.length < 4) {
    return { line: '', area: '', min: 0, max: 0, usable: false };
  }
  const min = Math.min(...elevations);
  const max = Math.max(...elevations);
  const span = Math.max(max - min, 1);
  const step = width / (elevations.length - 1);
  const points = elevations.map((value, i) => {
    const x = i * step;
    const y = height - 2 - ((value - min) / span) * (height - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = `M${points.join(' L')}`;
  const area = `${line} L${width},${height} L0,${height} Z`;
  return { line, area, min, max, usable: true };
}

/** Great-circle distance in km. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * The start point with the most neighbours inside 30 km — the closest thing
 * the data has to "home": there is no address, locality or country on the
 * fixture's routes, so the densest start cluster is the only honest anchor.
 */
export function findHub(
  routes: RouteSummary[],
): { lat: number; lng: number; count: number } | null {
  if (routes.length === 0) return null;
  let best = { lat: routes[0].start_lat, lng: routes[0].start_lng, count: 0 };
  for (const route of routes) {
    let count = 0;
    for (const other of routes) {
      if (haversineKm(route.start_lat, route.start_lng, other.start_lat, other.start_lng) <= 30) {
        count++;
      }
    }
    if (count > best.count) {
      best = { lat: route.start_lat, lng: route.start_lng, count };
    }
  }
  return best.count > 0 ? best : null;
}

export function sortRoutes(
  routes: RouteSummary[],
  sort: SortKey,
  hub?: { lat: number; lng: number } | null,
): RouteSummary[] {
  const copy = [...routes];
  switch (sort) {
    case 'nearest':
      if (!hub) return copy.sort((a, b) => b.created_at.localeCompare(a.created_at));
      return copy.sort(
        (a, b) =>
          haversineKm(hub.lat, hub.lng, a.start_lat, a.start_lng) -
          haversineKm(hub.lat, hub.lng, b.start_lat, b.start_lng),
      );
    case 'distance':
      return copy.sort((a, b) => b.distance_meters - a.distance_meters);
    case 'climb':
      return copy.sort(
        (a, b) => (b.elevation_gain_meters ?? 0) - (a.elevation_gain_meters ?? 0),
      );
    case 'ridden':
      return copy.sort((a, b) => b.ride_count - a.ride_count);
    case 'recent':
    default:
      return copy.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
}

export function activeFacetCount(facets: Facets): number {
  let n = 0;
  if (facets.distance !== 'any') n++;
  if (facets.climb !== 'any') n++;
  if (facets.status !== 'any') n++;
  if (facets.shape !== 'any') n++;
  if (facets.sport !== 'any') n++;
  return n;
}

/**
 * Facets -> the list endpoint's query parameters. Bands are resolved here so
 * the API keeps its existing min/max semantics (and server-side pagination).
 */
export function facetsToQuery(facets: Facets, sort: SortKey): RouteFilters {
  const query: RouteFilters = {
    q: facets.q.trim() || undefined,
    sport_type: facets.sport !== 'any' ? facets.sport : undefined,
  };

  if (facets.status === 'ridden') query.is_ridden = true;
  if (facets.status === 'unridden') query.is_ridden = false;
  if (facets.shape === 'loop') query.is_loop = true;
  if (facets.shape === 'point') query.is_loop = false;

  if (facets.distance === 'short') query.max_distance = 40_000;
  if (facets.distance === 'medium') {
    query.min_distance = 40_000;
    query.max_distance = 80_000;
  }
  if (facets.distance === 'long') query.min_distance = 80_000;

  if (facets.climb === 'flat') query.max_elevation = 400;
  if (facets.climb === 'rolling') {
    query.min_elevation = 400;
    query.max_elevation = 900;
  }
  if (facets.climb === 'big') query.min_elevation = 900;

  switch (sort) {
    case 'distance':
      query.sort_by = 'distance';
      break;
    case 'climb':
      query.sort_by = 'elevation';
      break;
    case 'ridden':
      query.sort_by = 'ride_count';
      break;
    default:
      query.sort_by = 'created_at';
  }
  query.sort_order = sort === 'ridden' ? 'desc' : 'desc';
  return query;
}

export function formatKm(meters: number): string {
  const km = meters / 1000;
  return `${km >= 100 ? Math.round(km) : km.toFixed(1).replace(/\.0$/, '')} km`;
}

export function formatClimb(meters: number | null | undefined): string {
  if (meters == null) return '—';
  return `${Math.round(meters).toLocaleString('en-GB')} m`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (!h) return `${m}m`;
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function riddenLabel(route: RouteSummary): string {
  if (!route.is_ridden) return 'Never ridden';
  return `Ridden ${route.ride_count}×`;
}

/** Deduped provider chain, with a multiplier when one provider appears twice. */
export function providerChain(route: Pick<RouteSummary, 'sources'>): string {
  const counts = new Map<string, number>();
  for (const source of route.sources) {
    counts.set(source.provider, (counts.get(source.provider) ?? 0) + 1);
  }
  return Array.from(counts)
    .map(([provider, count]) => (count > 1 ? `${provider} ×${count}` : provider))
    .join(' + ');
}

export function hasShape(route: Pick<RouteSummary, 'preview_polyline'>): boolean {
  return !!route.preview_polyline;
}

export function gpxFor(name: string, encoded: string | null | undefined): string {
  const points = decodePolyline(encoded);
  const body = points
    .map(([lat, lng]) => `<trkpt lat="${lat}" lon="${lng}"></trkpt>`)
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<gpx version="1.1" creator="FitTrack" xmlns="http://www.topografix.com/GPX/1/1">' +
    `<trk><name>${escapeXml(name)}</name><trkseg>${body}</trkseg></trk></gpx>`
  );
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
