import React from 'react';
import type { HrZonesResponse } from '@/lib/api';

export function HRZonesDisplay({ zones, lthr }: { zones: HrZonesResponse['zones']; lthr: number }) {
  const zoneColors: Record<string, string> = {
    'Z1': 'bg-blue-400',
    'Z2': 'bg-green-500',
    'Z3': 'bg-yellow-500',
    'Z4': 'bg-orange-500',
    'Z5': 'bg-red-500',
    'Z6': 'bg-purple-500',
  };

  return (
    <div className="space-y-2">
      <div className="text-xs text-muted mb-3">
        Based on LTHR: <span className="text-red-400 font-mono">{lthr} bpm</span>
      </div>
      {zones.map((zone) => (
        <div key={zone.zone} className="flex items-center gap-3">
          <div className="w-12 text-xs text-muted font-mono">{zone.zone}</div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-surface-light rounded-full h-4 overflow-hidden">
                <div
                  className={`h-full ${zoneColors[zone.zone] || 'bg-gray-500'} rounded-full transition-all`}
                  style={{ width: `${Math.min(zone.percentage, 100)}%` }}
                />
              </div>
              <div className="w-20 text-right text-xs font-mono text-white">
                {zone.percentage.toFixed(1)}%
              </div>
            </div>
            <div className="flex justify-between mt-0.5">
              <span className="text-xs text-muted">{zone.zone_name}</span>
              <span className="text-xs text-muted font-mono">
                {zone.lower_bound_hr}–{zone.upper_bound_hr} bpm
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
