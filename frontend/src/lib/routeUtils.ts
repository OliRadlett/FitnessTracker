/**
 * Shared route difficulty, elevation, and distance utilities.
 * Single source of truth — replaces scattered helpers in routes/page,
 * CompareRoutesModal, RoutesMapView, and ElevationProfile.
 *
 * DifficultyBadge (the UI component) now lives in components/routes/DifficultyBadge.tsx.
 */

// ── Difficulty (re-exported from the component) ───────────────────────────────

export type { DifficultyLevel } from '@/components/routes/DifficultyBadge';
export { DifficultyBadge, DIFFICULTY_STYLES } from '@/components/routes/DifficultyBadge';

export function computeDifficulty(
  elevationGainMeters: number | undefined | null,
  distanceMeters: number,
): import('@/components/routes/DifficultyBadge').DifficultyLevel | null {
  if (!elevationGainMeters || elevationGainMeters <= 0) return null;
  if (distanceMeters <= 0) return null;
  const elevPerKm = elevationGainMeters / (distanceMeters / 1000);
  if (elevPerKm < 10) return 'Easy';
  if (elevPerKm < 20) return 'Moderate';
  if (elevPerKm < 40) return 'Hard';
  return 'Extreme';
}

// ── Formatters ─────────────────────────────────────────────────────────────

/**
 * Whether two route names differ meaningfully, case- and space-insensitively.
 *
 * Used to warn before an `identical` merge on a differently-named pair.
 * `identical` merges are the ones that train the embedding metric, so they
 * are the ones where a wrong call is permanent — whereas a `variant` merge
 * is excluded from training and can be reclassified freely.
 *
 * Not a duplicate *test*, just a prompt to look: two names differing does not
 * make two routes distinct (Strava auto-generates names, so the same ride can
 * appear as "Evening Ride" and "Afternoon Ride"), and two names matching does
 * not make them identical.
 */
export function routeNamesDiffer(nameA: string | null, nameB: string | null): boolean {
  const norm = (n: string | null) => (n || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return norm(nameA) !== norm(nameB);
}

export function fmtElevation(meters: number): string {
  return `${Math.round(meters)} m`;
}

export function fmtDurationShort(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

// ── Haversine distance ─────────────────────────────────────────────────────

export function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
