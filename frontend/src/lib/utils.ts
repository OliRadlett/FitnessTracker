/**
 * Shared formatting utilities.
 *
 * Single source of truth for duration/distance formatting — previously each
 * page had its own inconsistent copy (BUG-044).
 */

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || seconds < 0) return '—';
  const total = Math.round(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  if (mins > 0) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  return `${secs}s`;
}

export function formatDistance(meters: number | null | undefined, precision = 2): string {
  if (meters == null || meters < 0) return '—';
  return `${(meters / 1000).toFixed(precision)} km`;
}

/**
 * Map a weather conditions string (e.g. "Partly Cloudy", "Light Rain") to an emoji.
 * Unknown/missing conditions fall back to 🌡️.
 */
export function weatherEmoji(conditions?: string | null): string {
  if (!conditions) return '🌡️';
  const c = conditions.toLowerCase();
  if (c.includes('thunder')) return '⛈️';
  if (c.includes('snow')) return '❄️';
  if (c.includes('fog')) return '🌫️';
  if (c.includes('drizzle') || c.includes('rain') || c.includes('shower')) return '🌧️';
  if (c.includes('overcast') || c.includes('cloudy')) return '☁️';
  if (c.includes('partly')) return '⛅';
  if (c.includes('clear')) return '☀️';
  return '🌡️';
}

/**
 * Format an ISO timestamp as a short relative label ("2h ago").
 * Returns 'never' for null/undefined so sync staleness is visibly honest.
 */
export function formatRelativeTime(dateStr?: string | null): string {
  if (!dateStr) return 'never';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (Number.isNaN(then)) return 'never';
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
