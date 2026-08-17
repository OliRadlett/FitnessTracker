import React from 'react';
import type { PowerZonesResponse } from '@/lib/api';

export function PowerZonesDisplay({ zones }: { zones: PowerZonesResponse['zones'] }) {
  const zoneColors: Record<string, string> = {
    '1': 'bg-blue-500',
    '2': 'bg-green-500',
    '3': 'bg-yellow-500',
    '4': 'bg-orange-500',
    '5': 'bg-red-500',
    '6': 'bg-purple-500',
    '7': 'bg-pink-500',
  };

  return (
    <div className="space-y-2">
      {zones.map((zone) => (
        <div key={zone.zone} className="flex items-center gap-3">
          <div className="w-12 text-xs text-muted font-mono">Z{zone.zone}</div>
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
                {zone.lower_bound_watts}–{zone.upper_bound_watts} W
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
