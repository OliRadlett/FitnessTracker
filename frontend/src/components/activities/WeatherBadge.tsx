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
  wind_direction,
  precipitation_mm,
}: {
  temperature: number | null;
  conditions: string | null;
  wind_speed_kmh: number | null;
  wind_direction?: string | null;
  precipitation_mm?: number | null;
}) {
  if (temperature == null && conditions == null) return null;

  const showWind = wind_speed_kmh != null && wind_speed_kmh > 24;

  const titleParts: string[] = [];
  if (conditions) titleParts.push(conditions);
  if (wind_speed_kmh != null) titleParts.push(`${Math.round(wind_speed_kmh)} km/h${wind_direction ? ` ${wind_direction}` : ''}`);
  if (precipitation_mm != null && precipitation_mm > 0) titleParts.push(`${precipitation_mm.toFixed(1)}mm rain`);
  const title = titleParts.join(' · ') || undefined;

  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted whitespace-nowrap" title={title}>
      <span aria-hidden="true">{weatherEmoji(conditions)}</span>
      {temperature != null && <span>{Math.round(temperature)}°C</span>}
      {showWind && (
        <span className="text-muted/70">
          💨 {Math.round(wind_speed_kmh)}km/h{wind_direction && <span className="ml-0.5">{wind_direction}</span>}
        </span>
      )}
      {precipitation_mm != null && precipitation_mm > 0 && (
        <span className="text-blue-400/70">🌧️ {precipitation_mm.toFixed(1)}mm</span>
      )}
    </span>
  );
}
