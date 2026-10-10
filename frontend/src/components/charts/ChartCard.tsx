'use client';

import React from 'react';
import type { ChartData } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { ChartBody, type ChartEmptyAction } from './Chart';
import { InsightCallout } from './InsightCallout';

interface ChartCardProps {
  title: React.ReactNode;
  actions?: React.ReactNode;
  /** One-line takeaway under the header — rendered via the shared InsightCallout. */
  insight?: React.ReactNode;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  data?: ChartData | null;
  emptyMessage?: React.ReactNode;
  /** One line naming the path to data ("Sync Whoop to populate"). */
  emptyHint?: React.ReactNode;
  /** Primary CTA for the empty state. */
  emptyAction?: ChartEmptyAction;
  /** Degraded state: `true` for a plain badge, string for badge detail. */
  stale?: boolean | string;
  height?: number;
  className?: string;
}

/**
 * Card wrapper around Chart with built-in loading, error, empty, and
 * degraded states. Use `actions` for range selectors or other header controls.
 */
export function ChartCard({
  title,
  actions,
  insight,
  isLoading,
  isError,
  onRetry,
  data,
  emptyMessage,
  emptyHint,
  emptyAction,
  stale,
  height = 320,
  className = '',
}: ChartCardProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between w-full">
          <CardTitle>{title}</CardTitle>
          {actions ? <div className="flex gap-2">{actions}</div> : null}
        </div>
        {insight && (
          <div className="mt-1.5">
            <InsightCallout>{insight}</InsightCallout>
          </div>
        )}
      </CardHeader>
      <ChartBody
        isLoading={isLoading}
        isError={isError}
        onRetry={onRetry}
        data={data ?? undefined}
        emptyMessage={emptyMessage}
        emptyHint={emptyHint}
        emptyAction={emptyAction}
        stale={stale}
        height={height}
      />
    </Card>
  );
}
