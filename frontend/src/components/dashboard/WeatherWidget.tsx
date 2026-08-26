'use client';

import React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAuthFetch, getCurrentWeather } from '@/lib/api';
import type { CurrentWeather } from '@/lib/api';
import { weatherEmoji } from '@/lib/utils';

/**
 * Dashboard weather card. Shows current conditions at the user's home
 * location (server-side resolution — no lat/lng passed). 404 = no location
 * set → compact prompt state.
 */
export function WeatherWidget() {
  const { token } = useAuthFetch();

  const { data: weather } = useQuery<CurrentWeather | null>({
    queryKey: ['weather-current'],
    queryFn: () => getCurrentWeather(token),
    staleTime: 15 * 60_000,
    retry: false, // 404 (no location set) is a normal state
  });

  return (
    <div className="bg-surface rounded-xl border border-surface-light/50 p-4 min-w-[220px]">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-base">🌤️</span>
        <p className="text-xs font-medium text-muted uppercase tracking-wider">Weather</p>
      </div>

      {!weather ? (
        <Link href="/settings" className="text-xs text-muted flex items-center gap-1.5 py-1 hover:text-white transition-colors">
          <span aria-hidden="true">📍</span> Set your home location in Settings
        </Link>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <span className="text-3xl leading-none" role="img" aria-label={weather.conditions}>
              {weatherEmoji(weather.conditions)}
            </span>
            <p className="text-2xl font-bold text-white leading-none">
              {Math.round(weather.temperature)}°C
            </p>
            <p className="text-sm text-muted">{weather.conditions}</p>
          </div>
          <p className="text-xs text-muted mt-2">
            Feels {Math.round(weather.apparent_temperature)}°C · 💨{' '}
            {Math.round(weather.wind_speed_kmh)} km/h {weather.wind_direction} · 💧{' '}
            {weather.precipitation_mm.toFixed(1)} mm
          </p>
        </>
      )}
    </div>
  );
}
