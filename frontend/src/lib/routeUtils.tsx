/**
 * Shared route difficulty, elevation, and distance utilities.
 * Single source of truth — replaces scattered helpers in routes/page,
 * CompareRoutesModal, MapBrowseView, and ElevationProfile.
 */

// ── Difficulty ─────────────────────────────────────────────────────────────

export type DifficultyLevel = 'Easy' | 'Moderate' | 'Hard' | 'Extreme';

export function computeDifficulty(
  elevationGainMeters: number | undefined | null,
  distanceMeters: number,
): DifficultyLevel | null {
  if (!elevationGainMeters || elevationGainMeters <= 0) return null;
  if (distanceMeters <= 0) return null;
  const elevPerKm = elevationGainMeters / (distanceMeters / 1000);
  if (elevPerKm < 10) return 'Easy';
  if (elevPerKm < 20) return 'Moderate';
  if (elevPerKm < 40) return 'Hard';
  return 'Extreme';
}

export const DIFFICULTY_STYLES: Record<DifficultyLevel, string> = {
  Easy: 'bg-green-500/20 text-positive border-green-500/30',
  Moderate: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  Hard: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  Extreme: 'bg-red-500/20 text-warning border-red-500/30',
};

export function DifficultyBadge({ level }: { level: DifficultyLevel }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${DIFFICULTY_STYLES[level]}`}
    >
      {level}
    </span>
  );
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
