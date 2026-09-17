'use client';

import React from 'react';
import type { CyclingProfile } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';

interface IntelligenceStatusCardProps {
  profile: CyclingProfile | undefined;
  isLoading: boolean;
}

export function IntelligenceStatusCard({ profile, isLoading }: IntelligenceStatusCardProps) {
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
      fitted: null, // stored in cross_domain table, not profile
      detail: 'Sleep-performance, lifting-cycling, race retrospective',
    },
    {
      name: 'Segment Intelligence',
      fitted: null, // stored on segments
      detail: 'DBSCAN clustering, climb classification, effort prediction',
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
                  ✓ {new Date(feature.fitted).toLocaleDateString()}
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
