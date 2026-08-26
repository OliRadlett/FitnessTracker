'use client';

import React from 'react';
import type { ChartData } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { ChartBody } from './Chart';

interface ChartCardProps {
  title: React.ReactNode;
  actions?: React.ReactNode;
  isLoading?: boolean;
  data?: ChartData | null;
  emptyMessage?: React.ReactNode;
  height?: number;
  className?: string;
}

/**
 * Card wrapper around Chart with built-in loading skeleton and empty state.
 * Use `actions` for range selectors or other header controls.
 */
export function ChartCard({
  title,
  actions,
  isLoading,
  data,
  emptyMessage,
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
      </CardHeader>
      <ChartBody
        isLoading={isLoading}
        data={data ?? undefined}
        emptyMessage={emptyMessage}
        height={height}
      />
    </Card>
  );
}
