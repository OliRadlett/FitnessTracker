'use client';

import React from 'react';
import type { CrossDomainInsightsResponse } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';

interface CrossDomainInsightsCardProps {
  crossDomainInsights: CrossDomainInsightsResponse | undefined;
  isLoading: boolean;
}

export function CrossDomainInsightsCard({
  crossDomainInsights,
  isLoading,
}: CrossDomainInsightsCardProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>🔗 Cross-Domain Insights</CardTitle>
        </CardHeader>
        <div className="text-sm text-muted">Loading insights...</div>
      </Card>
    );
  }

  if (!crossDomainInsights || Object.keys(crossDomainInsights).length === 0) {
    return null;
  }

  const insightTypes = Object.entries(crossDomainInsights);

  return (
    <Card>
      <CardHeader>
        <CardTitle>🔗 Cross-Domain Insights</CardTitle>
      </CardHeader>

      <div className="space-y-3">
        {insightTypes.map(([type, insight]) => (
          <div key={type} className="bg-surface-light rounded-lg p-3">
            <div className="text-xs text-muted mb-1">
              {type.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
            </div>

            {/* Insights */}
            {insight.insights && insight.insights.length > 0 && (
              <ul className="space-y-1">
                {insight.insights.slice(0, 3).map((item, i) => (
                  <li key={i} className="text-sm text-muted">
                    • {item}
                  </li>
                ))}
              </ul>
            )}

            {/* Analyzed At */}
            {insight.analyzed_at && (
              <div className="mt-2 text-xs text-muted">
                Last analyzed: {new Date(insight.analyzed_at).toLocaleDateString()}
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
