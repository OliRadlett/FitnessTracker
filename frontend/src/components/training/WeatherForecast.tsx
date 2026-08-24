'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthFetch, getForecast } from '@/lib/api';
import type { ForecastDay } from '@/lib/api';
import { weatherEmoji } from '@/lib/utils';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';

/**
 * Bad-weather heuristic for cycling (mirrors backend thresholds).
 */
function isPoorCyclingWeather(day: ForecastDay): boolean {
  return (
    day.temp_max > 32 ||
    day.temp_min < 5 ||
    day.wind_speed_max > 40 ||
    (day.precipitation_probability ?? 0) > 50 ||
    (day.precipitation_sum ?? 0) > 2 ||
    /rain|snow|drizzle|shower|fog|thunder/i.test(day.conditions)
  );
}

function weekdayShort(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' });
}

function DayChip({ day }: { day: ForecastDay }) {
  const poor = isPoorCyclingWeather(day);
  const precipPct = day.precipitation_probability;

  return (
    <div
      className={`relative flex-1 min-w-[110px] p-3 rounded-lg border text-center ${
        poor ? 'bg-red-500/5 border-red-500/30' : 'bg-surface-light/30 border-surface-light/50'
      }`}
    >
      {poor && (
        <span
          className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-orange-500"
          title="Poor cycling conditions"
          aria-label="Poor cycling conditions"
        />
      )}
      <p className="text-xs font-medium text-muted">{weekdayShort(day.date)}</p>
      <p className="text-xl my-1" role="img" aria-label={day.conditions}>
        {weatherEmoji(day.conditions)}
      </p>
      <p className="text-sm text-white">
        {Math.round(day.temp_max)}° <span className="text-muted">/ {Math.round(day.temp_min)}°</span>
      </p>
      <p className="text-[10px] text-muted mt-0.5">
        💨 {Math.round(day.wind_speed_max)} km/h
      </p>
      {precipPct != null && precipPct >= 50 && (
        <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300">
          💧 {precipPct}%
        </span>
      )}
    </div>
  );
}

/**
 * 7-day weather forecast strip for the training page — highlights days with
 * poor cycling conditions so plans can be shuffled around bad weather.
 */
export function WeatherForecast() {
  const { token } = useAuthFetch();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['weather-forecast'],
    queryFn: () => getForecast(token, 7),
    staleTime: 30 * 60_000,
    retry: false, // 404 (no location set) is a normal state
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>🌦️ 7-Day Forecast</CardTitle>
        </CardHeader>
        <div className="flex gap-3 overflow-x-auto">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex-1 min-w-[110px] h-24 bg-surface-light/30 rounded-lg animate-pulse" />
          ))}
        </div>
      </Card>
    );
  }

  // No location set (404 → null) or request failed — stay quiet.
  if (!data || isError || data.days.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>🌦️ 7-Day Forecast</CardTitle>
      </CardHeader>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {data.days.map((day) => (
          <DayChip key={day.date} day={day} />
        ))}
      </div>
    </Card>
  );
}
