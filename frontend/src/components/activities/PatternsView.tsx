'use client';

import { useMemo, useState } from 'react';
import type { Activity, ActivityFilters } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { formatDistance, formatDuration } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import { STRENGTH_TYPES } from '@/lib/sportUtils';

interface PatternPreset {
  id: string;
  label: string;
  description: string;
  filters: ActivityFilters;
}

const PATTERN_PRESETS: PatternPreset[] = [
  {
    id: 'hard-rides',
    label: 'Hard Rides',
    description: 'TSS ≥ 80 — demanding training sessions',
    filters: { min_tss: 80 },
  },
  {
    id: 'recovery-rides',
    label: 'Easy Rides',
    description: 'TSS ≤ 40 — recovery and endurance work',
    filters: { max_tss: 40 },
  },
  {
    id: 'long-rides',
    label: 'Long Rides',
    description: 'Distance > 50km — extended efforts',
    filters: { min_distance: 50000 },
  },
  {
    id: 'high-power',
    label: 'High Power',
    description: 'Average power ≥ 200W — sustained threshold work',
    filters: { min_tss: 60 },
  },
  {
    id: 'no-tss',
    label: 'No TSS',
    description: 'Activities without recorded TSS',
    filters: { max_tss: 1 },
  },
  {
    id: 'recent',
    label: 'Last 7 Days',
    description: 'Activities from the last week',
    filters: { start_date_after: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString() },
  },
];

interface PatternsViewProps {
  activities: Activity[];
  statsActivities: Activity[];
  isLoading: boolean;
  onPatternSelect: (filters: ActivityFilters) => void;
}

export function PatternsView({ activities, statsActivities, isLoading, onPatternSelect }: PatternsViewProps) {
  const [selectedPattern, setSelectedPattern] = useState<string | null>(null);

  const combinedActivities = useMemo(() => {
    // Use statsActivities (200 activities, 6 months) for pattern analysis
    return statsActivities.length > 0 ? statsActivities : activities;
  }, [statsActivities, activities]);

  const handlePatternClick = (pattern: PatternPreset) => {
    setSelectedPattern(pattern.id);
    onPatternSelect(pattern.filters);
  };

  // Show filtered activities for selected pattern
  const filteredActivities = useMemo(() => {
    if (!selectedPattern) return [];
    const pattern = PATTERN_PRESETS.find((p) => p.id === selectedPattern);
    if (!pattern) return [];

    return combinedActivities.filter((a) => {
      const f = pattern.filters;
      if (f.sport_type && a.sport_type !== f.sport_type) return false;
      if (f.min_distance && (a.distance_meters ?? 0) < f.min_distance) return false;
      if (f.max_distance && (a.distance_meters ?? 0) > f.max_distance) return false;
      if (f.min_duration && (a.duration_seconds ?? 0) < f.min_duration) return false;
      if (f.max_duration && (a.duration_seconds ?? 0) > f.max_duration) return false;
      if (f.min_tss !== undefined && (a.tss ?? 0) < f.min_tss) return false;
      if (f.max_tss !== undefined && (a.tss ?? 0) > f.max_tss) return false;
      if (f.start_date_after && new Date(a.start_date) < new Date(f.start_date_after)) return false;
      if (f.start_date_before && new Date(a.start_date) > new Date(f.start_date_before)) return false;
      return true;
    });
  }, [selectedPattern, combinedActivities]);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

  return (
    <div className="space-y-6">
      {/* Pattern Presets */}
      <div>
        <h3 className="text-sm font-medium text-muted mb-3">Presets</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
          {PATTERN_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => handlePatternClick(p)}
              className={`p-3 rounded-lg border text-left transition-all ${
                selectedPattern === p.id
                  ? 'bg-accent/20 border-accent/50 text-white'
                  : 'bg-surface border-surface-light hover:border-accent/30 text-muted hover:text-white'
              }`}
            >
              <div className="font-medium text-sm">{p.label}</div>
              <div className="text-xs text-muted/70 mt-0.5">{p.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Custom Pattern Builder */}
      <div>
        <h3 className="text-sm font-medium text-muted mb-3">Custom Range</h3>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col">
            <label className="text-xs text-muted mb-1">Min TSS</label>
            <input
              type="number"
              min="0"
              step="1"
              placeholder="0"
              className="w-24 bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent placeholder:text-muted/60"
              onChange={(e) => {
                if (e.target.value) {
                  onPatternSelect({ min_tss: parseFloat(e.target.value) });
                  setSelectedPattern(null);
                }
              }}
            />
          </div>
          <div className="flex flex-col">
            <label className="text-xs text-muted mb-1">Max TSS</label>
            <input
              type="number"
              min="0"
              step="1"
              placeholder="∞"
              className="w-24 bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent placeholder:text-muted/60"
              onChange={(e) => {
                if (e.target.value) {
                  onPatternSelect({ max_tss: parseFloat(e.target.value) });
                  setSelectedPattern(null);
                }
              }}
            />
          </div>
          <button
            onClick={() => { setSelectedPattern(null); onPatternSelect({}); }}
            className="text-xs text-muted hover:text-white px-3 py-1 rounded border border-surface-light hover:bg-surface-light/50 transition-colors"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Results */}
      {selectedPattern && (
        <div>
          <h3 className="text-sm font-medium text-muted mb-3">
            {PATTERN_PRESETS.find((p) => p.id === selectedPattern)?.label ?? 'Results'}
            {' '}
            <span className="text-xs text-muted/70">({filteredActivities.length} matches)</span>
          </h3>
          {filteredActivities.length === 0 ? (
            <p className="text-sm text-muted">No activities match this pattern.</p>
          ) : (
            <div className="space-y-2">
              {filteredActivities.map((a) => {
                const isStrength = STRENGTH_TYPES.includes(a.sport_type);
                return (
                  <Card key={a.id} className="p-3">
                    <div className="flex items-center gap-3">
                      <Badge
                        variant={isStrength ? 'lifting' : a.sport_type === 'cycling' ? 'cycling' : 'default'}
                      >
                        {a.sport_type}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{a.name}</p>
                        <p className="text-xs text-muted">
                          {formatDate(a.start_date)}
                          {a.route_name && (
                            <span className="ml-2 text-accent">📍 {a.route_name}</span>
                          )}
                        </p>
                      </div>
                      <div className="flex gap-4 text-xs text-muted">
                        {!isStrength && a.distance_meters && (
                          <span>{formatDistance(a.distance_meters, 1)}</span>
                        )}
                        {a.duration_seconds && <span>{formatDuration(a.duration_seconds)}</span>}
                        {a.average_power && <span className="text-yellow-400">{a.average_power} W</span>}
                        {a.tss && a.tss > 0 && <span className="text-blue-400">{a.tss} TSS</span>}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Summary stats for current dataset */}
      {!selectedPattern && combinedActivities.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
          <div>
            <p className="text-2xl font-bold text-white">{combinedActivities.length}</p>
            <p className="text-xs text-muted">Activities</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-white">
              {Math.round(combinedActivities.reduce((s, a) => s + (a.tss ?? 0), 0))}
            </p>
            <p className="text-xs text-muted">Total TSS</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-white">
              {combinedActivities.filter((a) => a.sport_type === 'cycling').length}
            </p>
            <p className="text-xs text-muted">Rides</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-white">
              {Math.round(
                combinedActivities.reduce((s, a) => s + (STRENGTH_TYPES.includes(a.sport_type) ? 0 : (a.distance_meters ?? 0)), 0) / 1000,
              )}
            </p>
            <p className="text-xs text-muted">km Distance</p>
          </div>
        </div>
      )}
    </div>
  );
}
