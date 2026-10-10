'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type { ChartData } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { ChartBody } from '@/components/charts/Chart';
import { Zap } from 'lucide-react';

/**
 * B-31 unified training-load chart — cycling TSS + lifting estimates on one
 * axis. Shared by /analytics and the lifting Analytics tab (same query key,
 * so both pages read one cache entry).
 */
export function CombinedLoadChart({ days = 90, stale }: { days?: number; stale?: boolean | string }) {
  const { authFetch, token } = useAuthFetch();
  const { data, isLoading } = useQuery<ChartData>({
    queryKey: ['chart-combined-load', days],
    queryFn: () => authFetch<ChartData>(`/api/v1/charts/combined_training_load?days=${days}`),
    staleTime: 300_000,
    enabled: !!token,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="inline-flex items-center gap-1.5">
            <Zap className="w-4 h-4" aria-hidden />
            Combined Training Load
          </span>
        </CardTitle>
      </CardHeader>
      <p className="text-xs text-muted mb-2">
        Cycling TSS + lifting estimates (duration×RPE) — one axis for total stress.
      </p>
      <ChartBody
        isLoading={isLoading}
        data={data}
        emptyMessage="No combined load yet"
        emptyHint="Log rides or lifts — cycling TSS and lifting estimates appear here together."
        height={260}
        stale={stale}
      />
    </Card>
  );
}
