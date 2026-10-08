'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CyclingProfile } from '@/lib/api';
import { useAuthFetch } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { getActiveLocale } from '@/lib/utils';

interface IntelligenceStatusCardProps {
  profile: CyclingProfile | undefined;
  isLoading: boolean;
}

interface CrossDomainStatus {
  analyzed_at: string | null;
  insight_count: number;
}

interface SegmentStatus {
  analyzed_at: string | null;
  segment_count: number;
  analyzed_count: number;
}

export function IntelligenceStatusCard({ profile, isLoading }: IntelligenceStatusCardProps) {
  const { authFetch, token } = useAuthFetch();

  // Cross-domain + segment fitted markers live outside CyclingProfile
  // (cross_domain_insights rows, segments.intelligence_analyzed_at), so the
  // card fetches the lightweight status endpoints. Both return 200 with
  // analyzed_at=null when never fitted -- never 404 -- so a missing run
  // renders "Not yet fitted" rather than an error.
  const { data: crossDomainStatus } = useQuery<CrossDomainStatus>({
    queryKey: ['intelligence-status', 'cross-domain'],
    queryFn: () => authFetch<CrossDomainStatus>('/api/v1/cross-domain/status'),
    staleTime: 300_000,
    retry: false,
    enabled: !!token,
  });

  const { data: segmentStatus } = useQuery<SegmentStatus>({
    queryKey: ['intelligence-status', 'segments'],
    queryFn: () => authFetch<SegmentStatus>('/api/v1/segments/status'),
    staleTime: 300_000,
    retry: false,
    enabled: !!token,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>🧠 Modal Intelligence Status</CardTitle>
        </CardHeader>
        <div className="text-sm text-muted">Loading status...</div>
      </Card>
    );
  }

  const features = [
    {
      name: 'Power Model',
      fitted: profile?.power_model_fitted_at,
      detail: profile?.critical_power
        ? `CP: ${profile.critical_power}W, VO2max: ${profile.personalized_vo2max?.toFixed(1) ?? '—'}`
        : null,
    },
    {
      name: 'Weather Analysis',
      fitted: profile?.weather_analyzed_at,
      detail: profile?.weather_coefficients
        ? 'Coefficients computed'
        : null,
    },
    {
      name: 'Cross-Domain Insights',
      fitted: crossDomainStatus?.analyzed_at ?? null,
      detail:
        crossDomainStatus && crossDomainStatus.insight_count > 0
          ? `${crossDomainStatus.insight_count} insight${crossDomainStatus.insight_count === 1 ? '' : 's'}`
          : 'Sleep-performance, lifting-cycling, race retrospective',
    },
    {
      name: 'Segment Intelligence',
      fitted: segmentStatus?.analyzed_at ?? null,
      detail:
        segmentStatus && segmentStatus.segment_count > 0
          ? `${segmentStatus.analyzed_count}/${segmentStatus.segment_count} segments analyzed`
          : 'DBSCAN clustering, climb classification, effort prediction',
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>🧠 Modal Intelligence Status</CardTitle>
      </CardHeader>

      <div className="space-y-2">
        {features.map((feature) => (
          <div key={feature.name} className="flex items-center justify-between p-2 bg-surface-light rounded-lg">
            <div>
              <div className="text-sm font-medium">{feature.name}</div>
              {feature.detail && (
                <div className="text-xs text-muted">{feature.detail}</div>
              )}
            </div>
            <div className="text-xs">
              {feature.fitted ? (
                <span className="text-positive">
                  ✓ {new Date(feature.fitted).toLocaleDateString(getActiveLocale())}
                </span>
              ) : (
                <span className="text-muted">Not yet fitted</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 text-xs text-muted">
        Intelligence tasks run weekly on Sundays via Modal serverless containers.
      </div>
    </Card>
  );
}
