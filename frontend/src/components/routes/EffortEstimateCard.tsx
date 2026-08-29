'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type { EffortEstimateResponse } from '@/lib/api/types';
import { formatDuration } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';

export function EffortEstimateCard({ routeId }: {
  routeId: string;
}) {
  const { authFetch } = useAuthFetch();

  const { data: estimate, isPending, isError } = useQuery<EffortEstimateResponse>({
    queryKey: ['route-effort', routeId],
    queryFn: () => authFetch<EffortEstimateResponse>(`/api/v1/routes/${routeId}/effort-estimate`),
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
        <Badge variant="default" className="text-xs">
          {estimate.zone_name || 'Threshold'}
        </Badge>
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
