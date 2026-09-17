'use client';

import React from 'react';
import type { WeatherAnalysisResponse } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';

interface WeatherAnalysisSectionProps {
  weatherAnalysis: WeatherAnalysisResponse | undefined;
  isLoading: boolean;
}

export function WeatherAnalysisSection({ weatherAnalysis, isLoading }: WeatherAnalysisSectionProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>🌤️ Weather-Performance Analysis</CardTitle>
        </CardHeader>
        <div className="text-sm text-muted">Loading weather analysis...</div>
      </Card>
    );
  }

  if (!weatherAnalysis) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>🌤️ Weather-Performance Analysis</CardTitle>
        </CardHeader>
        <div className="text-sm text-muted">
          Weather analysis not yet available. Analysis runs weekly on Sundays.
          Requires Strava activities with weather data.
        </div>
      </Card>
    );
  }

  const { power_vs_temp, power_vs_wind, decoupling_vs_temp, hr_vs_temp, personalized_insights } = weatherAnalysis;

  return (
    <Card>
      <CardHeader>
        <CardTitle>🌤️ Weather-Performance Analysis</CardTitle>
      </CardHeader>

      {/* Power vs Temperature */}
      {power_vs_temp && (
        <div className="mb-4">
          <div className="text-xs text-muted mb-2">Power vs Temperature</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="bg-surface-light rounded-lg p-3">
              <div className="text-xs text-muted">Temperature Effect</div>
              <div className="text-lg font-mono font-bold text-accent">
                {power_vs_temp.slope_per_celsius ? (
                  `${power_vs_temp.slope_per_celsius > 0 ? '+' : ''}${power_vs_temp.slope_per_celsius.toFixed(2)} W/°C`
                ) : '—'}
              </div>
            </div>
            <div className="bg-surface-light rounded-lg p-3">
              <div className="text-xs text-muted">Optimal Range</div>
              <div className="text-lg font-mono font-bold text-positive">
                {power_vs_temp.optimal_range_c
                  ? `${power_vs_temp.optimal_range_c[0]}–${power_vs_temp.optimal_range_c[1]}°C`
                  : '—'}
              </div>
            </div>
            <div className="bg-surface-light rounded-lg p-3">
              <div className="text-xs text-muted">R² Fit</div>
              <div className="text-lg font-mono font-bold text-muted">
                {power_vs_temp.r_squared
                  ? `${(power_vs_temp.r_squared * 100).toFixed(1)}%`
                  : '—'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Power vs Wind */}
      {power_vs_wind && (
        <div className="mb-4">
          <div className="text-xs text-muted mb-2">Wind Effects</div>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-surface-light rounded-lg p-3">
              <div className="text-xs text-muted">Headwind Penalty</div>
              <div className="text-lg font-mono font-bold text-red-400">
                {power_vs_wind.headwind_penalty_pct
                  ? `${power_vs_wind.headwind_penalty_pct.toFixed(1)}%`
                  : '—'}
              </div>
            </div>
            <div className="bg-surface-light rounded-lg p-3">
              <div className="text-xs text-muted">Tailwind Boost</div>
              <div className="text-lg font-mono font-bold text-positive">
                {power_vs_wind.tailwind_boost_pct
                  ? `+${power_vs_wind.tailwind_boost_pct.toFixed(1)}%`
                  : '—'}
              </div>
            </div>
            <div className="bg-surface-light rounded-lg p-3">
              <div className="text-xs text-muted">Crosswind Penalty</div>
              <div className="text-lg font-mono font-bold text-yellow-400">
                {power_vs_wind.crosswind_penalty_pct
                  ? `${power_vs_wind.crosswind_penalty_pct.toFixed(1)}%`
                  : '—'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Decoupling vs Temperature */}
      {decoupling_vs_temp && (
        <div className="mb-4">
          <div className="text-xs text-muted mb-2">Decoupling vs Temperature</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-surface-light rounded-lg p-3">
              <div className="text-xs text-muted">Heat Penalty Above</div>
              <div className="text-lg font-mono font-bold text-yellow-400">
                {decoupling_vs_temp.threshold_c
                  ? `${decoupling_vs_temp.threshold_c}°C`
                  : '—'}
              </div>
            </div>
            <div className="bg-surface-light rounded-lg p-3">
              <div className="text-xs text-muted">Penalty Magnitude</div>
              <div className="text-lg font-mono font-bold text-red-400">
                {decoupling_vs_temp.penalty_above_pct
                  ? `${decoupling_vs_temp.penalty_above_pct.toFixed(1)}%`
                  : '—'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* HR vs Temperature */}
      {hr_vs_temp && hr_vs_temp.slope_bpm_per_celsius && (
        <div className="mb-4">
          <div className="text-xs text-muted mb-2">Heart Rate vs Temperature</div>
          <div className="bg-surface-light rounded-lg p-3">
            <div className="text-xs text-muted">HR Drift per °C</div>
            <div className="text-lg font-mono font-bold text-accent">
              +{hr_vs_temp.slope_bpm_per_celsius.toFixed(2)}{' '}
              <span className="text-xs text-muted">bpm/°C</span>
            </div>
          </div>
        </div>
      )}

      {/* Personalized Insights */}
      {personalized_insights && personalized_insights.length > 0 && (
        <div className="mt-4 border-t border-surface-light pt-3">
          <div className="text-xs text-muted mb-2">Insights</div>
          <ul className="space-y-1">
            {personalized_insights.map((insight, i) => (
              <li key={i} className="text-sm text-muted">
                • {insight}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Analyzed At */}
      <div className="mt-3 text-xs text-muted">
        Last analyzed: {weatherAnalysis.analyzed_at
          ? new Date(weatherAnalysis.analyzed_at).toLocaleDateString()
          : 'Never'}
      </div>
    </Card>
  );
}
