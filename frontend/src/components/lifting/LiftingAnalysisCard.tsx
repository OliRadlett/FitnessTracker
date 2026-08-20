'use client';

import React from 'react';
import type { LiftingAnalysis, ChartData } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Chart } from '@/components/charts/Chart';

interface LiftingAnalysisCardProps {
  analysis: LiftingAnalysis;
}

function fatigueColor(index: number): string {
  if (index < 40) return 'text-positive';
  if (index < 70) return 'text-warning';
  return 'text-red-400';
}

function StatBadge({ label, value, className = '' }: { label: string; value: string | number; className?: string }) {
  return (
    <div className="bg-surface-light/30 rounded-lg px-4 py-3 text-center">
      <p className="text-xs text-muted uppercase tracking-wide">{label}</p>
      <p className={`text-lg font-semibold text-white mt-1 ${className}`}>{value}</p>
    </div>
  );
}

export function LiftingAnalysisCard({ analysis }: LiftingAnalysisCardProps) {
  // Volume Breakdown — pie chart
  const volumeChartData: ChartData = {
    chart_type: 'pie',
    title: 'Volume Breakdown',
    labels: analysis.volume_breakdown.map((v) => v.exercise_name),
    series: [
      {
        name: 'Volume (kg)',
        data: analysis.volume_breakdown.map((v) => v.volume_kg),
      },
    ],
  };

  // Set Progression — multi-series line chart (estimated 1RM across sets)
  const progressionExercises = Object.keys(analysis.set_progression);
  const maxSets = Math.max(
    ...progressionExercises.map((ex) => analysis.set_progression[ex].length),
    0,
  );
  const progressionLabels = Array.from({ length: maxSets }, (_, i) => `Set ${i + 1}`);
  const progressionChartData: ChartData = {
    chart_type: 'line',
    title: 'Set Progression (Estimated 1RM)',
    labels: progressionLabels,
    x_label: 'Set',
    y_label: 'Est. 1RM (kg)',
    series: progressionExercises.map((ex) => ({
      name: ex,
      data: analysis.set_progression[ex].map((p) => p.estimated_1rm ?? null),
    })),
  };

  // Rep Dropoff — bar chart
  const dropoffChartData: ChartData = {
    chart_type: 'bar',
    title: 'Rep Dropoff',
    labels: analysis.rep_dropoff.map((d) => d.exercise_name),
    y_label: 'Dropoff %',
    series: [
      {
        name: 'Dropoff %',
        data: analysis.rep_dropoff.map((d) => d.dropoff_pct),
      },
    ],
  };

  // PR Proximity — bar chart
  const prProximityChartData: ChartData = {
    chart_type: 'bar',
    title: 'PR Proximity',
    labels: analysis.pr_proximity.map((p) => p.exercise_name),
    y_label: 'Proximity %',
    series: [
      {
        name: 'Proximity %',
        data: analysis.pr_proximity.map((p) => p.proximity_pct),
      },
    ],
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Session Analysis</CardTitle>
      </CardHeader>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatBadge label="Exercises" value={analysis.exercise_count} />
        <StatBadge label="Working Sets" value={analysis.working_sets_count} />
        <StatBadge
          label="Fatigue Index"
          value={analysis.fatigue_index.toFixed(1)}
          className={fatigueColor(analysis.fatigue_index)}
        />
        {analysis.session_density != null && (
          <StatBadge
            label="Session Density"
            value={`${analysis.session_density.toFixed(1)} kg/min`}
          />
        )}
      </div>

      {/* Volume Breakdown */}
      {analysis.volume_breakdown.length > 0 && (
        <div className="mb-6">
          <Chart data={volumeChartData} height={300} />
        </div>
      )}

      {/* Set Progression */}
      {progressionExercises.length > 0 && (
        <div className="mb-6">
          <Chart data={progressionChartData} height={300} />
        </div>
      )}

      {/* Rep Dropoff */}
      {analysis.rep_dropoff.length > 0 && (
        <div className="mb-6">
          <Chart data={dropoffChartData} height={250} />
        </div>
      )}

      {/* PR Proximity */}
      {analysis.pr_proximity.length > 0 && (
        <div className="mb-6">
          <Chart data={prProximityChartData} height={250} />
        </div>
      )}

      {/* RPE Analysis */}
      {(analysis.rpe_analysis.session_rpe != null ||
        analysis.rpe_analysis.avg_set_rpe != null) && (
        <div className="bg-surface-light/30 rounded-lg p-4">
          <h4 className="text-sm font-medium text-muted mb-3">RPE Analysis</h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {analysis.rpe_analysis.session_rpe != null && (
              <StatBadge label="Session RPE" value={analysis.rpe_analysis.session_rpe.toFixed(1)} />
            )}
            {analysis.rpe_analysis.avg_set_rpe != null && (
              <StatBadge label="Avg Set RPE" value={analysis.rpe_analysis.avg_set_rpe.toFixed(1)} />
            )}
            {analysis.rpe_analysis.rpe_vs_volume_correlation != null && (
              <StatBadge
                label="RPE-Volume Correlation"
                value={analysis.rpe_analysis.rpe_vs_volume_correlation.toFixed(2)}
              />
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
