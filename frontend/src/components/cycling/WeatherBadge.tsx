'use client';

import React from 'react';
import { weatherEmoji } from '@/lib/utils';

/**
 * Tiny inline weather indicator for activity rows — e.g. "🌧️ 12°C 💨 25km/h".
 * Wind only shown when >25 km/h. Renders nothing when untagged.
 */
export function WeatherBadge({
  temperature,
  conditions,
  wind_speed_kmh,
}: {
  temperature: number | null;
  conditions: string | null;
  wind_speed_kmh: number | null;
}) {
  if (temperature == null && conditions == null) return null;

  const showWind = wind_speed_kmh != null && wind_speed_kmh > 25;

  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted whitespace-nowrap" title={conditions ?? undefined}>
      <span aria-hidden="true">{weatherEmoji(conditions)}</span>
      {temperature != null && <span>{Math.round(temperature)}°C</span>}
      {showWind && <span className="text-muted/70">💨 {Math.round(wind_speed_kmh)}km/h</span>}
    </span>
  );
}
