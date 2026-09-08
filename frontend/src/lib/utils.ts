/**
 * Shared formatting utilities.
 *
 * Single source of truth for duration/distance formatting — previously each
 * page had its own inconsistent copy (BUG-044).
 *
 * Distance/date/time formatting honors the active user preference when set
 * (`setActivePreferences` from `lib/units.tsx` — the UnitsProvider in
 * (app)/layout.tsx syncs the fetched server-side prefs here). Falls back to
 * metric / en-GB / 24h.
 */

import type { DateLocale, TimeFormat, UnitSystem } from '@/lib/api/types/preferences';

let activeUnitSystem: UnitSystem = 'metric';
let activeLocale: DateLocale = 'en-GB';
let activeTimeFormat: TimeFormat = '24h';

/** Sync the module-level formatting preferences (called by UnitsProvider). */
export function setActivePreferences(prefs: {
  unit_system?: UnitSystem;
  locale?: DateLocale;
  time_format?: TimeFormat;
}): void {
  activeUnitSystem = prefs.unit_system ?? activeUnitSystem;
  activeLocale = prefs.locale ?? activeLocale;
  activeTimeFormat = prefs.time_format ?? activeTimeFormat;
}

export function getActiveUnitSystem(): UnitSystem {
  return activeUnitSystem;
}

export function getActiveLocale(): DateLocale {
  return activeLocale;
}

export function getActiveTimeFormat(): TimeFormat {
  return activeTimeFormat;
}

/** metres → "12.5 km" or miles when imperial is active. */
export function formatDistance(meters: number | null | undefined, precision = 2, unitSystem: UnitSystem = activeUnitSystem): string {
  if (meters == null || meters < 0) return '—';
  if (unitSystem === 'imperial') {
    return `${(meters / 1609.344).toFixed(precision)} mi`;
  }
  return `${(meters / 1000).toFixed(precision)} km`;
}

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

/** kilograms → "75.5 kg" / "166.4 lb" — honors active unit system. */
export function formatWeight(kg: number | null | undefined, unitSystem: UnitSystem = activeUnitSystem): string {
  if (kg == null || !Number.isFinite(kg)) return '—';
  if (unitSystem === 'imperial') {
    return `${(kg * 2.2046226218).toFixed(1)} lb`;
  }
  return `${kg.toFixed(1)} kg`;
}

/** Convert a display-side weight value (lb or kg) into kilograms. */
export function displayWeightToKg(value: number, unitSystem: UnitSystem = activeUnitSystem): number {
  if (unitSystem === 'imperial') return value / 2.2046226218;
  return value;
}

/** Convert kilograms into the active display unit (lb or kg), numeric value. */
export function kgToDisplayWeight(kg: number, unitSystem: UnitSystem = activeUnitSystem): number {
  if (unitSystem === 'imperial') return kg * 2.2046226218;
  return kg;
}

/** Format an ISO date string (YYYY-MM-DD) as "21 Mar 2026". Honors active locale. */
export function formatDateDMY(dateStr: string | null | undefined, locale: DateLocale = activeLocale): string {
  if (!dateStr) return '—';
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Format an ISO timestamp as a short time ("14:35" / "2:35 PM"). Honors 12/24h. */
export function formatTime(
  iso: string | null | undefined,
  locale: DateLocale = activeLocale,
  timeFormat: TimeFormat = activeTimeFormat,
): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: timeFormat === '12h',
  });
}

/** Format a data-fetch timestamp (epoch ms) as "14:35" for the "last updated"
 * label. Returns "—" for null/zero/invalid (§3.15). */
export function formatUpdatedAt(
  epochMs: number | null | undefined,
  locale: DateLocale = activeLocale,
  timeFormat: TimeFormat = activeTimeFormat,
): string {
  if (!epochMs || epochMs <= 0) return '—';
  const d = new Date(epochMs);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: timeFormat === '12h',
  });
}
