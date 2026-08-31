'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type { EffortEstimateResponse } from '@/lib/api/types';
import { formatDuration } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';

const INTENSITY_OPTIONS = [
  { value: 'endurance', label: 'Endurance (Z2)' },
  { value: 'tempo', label: 'Tempo (Z3)' },
  { value: 'threshold', label: 'Threshold (Z4)' },
  { value: 'vo2max', label: 'VO2 Max (Z5)' },
  { value: 'anaerobic', label: 'Anaerobic (Z6)' },
] as const;

export function EffortEstimateCard({ routeId }: {
  routeId: string;
}) {
  const { authFetch, token } = useAuthFetch();
  const [intensity, setIntensity] = useState('tempo');

  const { data: estimate, isPending, isError } = useQuery<EffortEstimateResponse>({
    queryKey: ['route-effort', routeId, intensity],
    queryFn: () => authFetch<EffortEstimateResponse>(
      `/api/v1/routes/${routeId}/effort-estimate?intensity=${intensity}`
    ),
    enabled: !!token,
    staleTime: 300_000,
  });

  if (isPending) {
    return (
      <div className="animate-pulse">
        <div className="h-4 bg-surface-light rounded w-3/4 mb-2" />
        <div className="h-3 bg-surface-light rounded w-1/2" />
      </div>
    );
  }

  if (isError || !estimate) {
    return (
      <p className="text-xs text-muted">
        Configure your FTP and weight in Settings to get effort estimates.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs text-muted uppercase tracking-wider">Effort Estimate</h4>
        <div className="flex items-center gap-2">
          <select
            value={intensity}
            onChange={(e) => setIntensity(e.target.value)}
            className="text-xs bg-surface-light border border-surface rounded px-2 py-1 text-muted focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {INTENSITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <Badge variant="default" className="text-xs">
            {estimate.zone_name || 'Tempo'}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-muted">Est. Time</p>
          <p className="text-white font-medium">{formatDuration(estimate.estimated_time_seconds)}</p>
        </div>
        <div>
          <p className="text-muted">Est. TSS</p>
          <p className="text-white font-medium">{Math.round(estimate.estimated_tss)}</p>
        </div>
        <div>
          <p className="text-muted">Norm. Power</p>
          <p className="text-yellow-400 font-medium">
            {estimate.normalized_power ? `${Math.round(estimate.normalized_power)} W` : '—'}
          </p>
        </div>
        <div>
          <p className="text-muted">Est. Calories</p>
          <p className="text-accent font-medium">
            {estimate.estimated_kcal ? `${Math.round(estimate.estimated_kcal)} kcal` : '—'}
          </p>
        </div>
      </div>

      {estimate.description && (
        <p className="text-xs text-muted">{estimate.description}</p>
      )}
    </div>
  );
}
