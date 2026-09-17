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
