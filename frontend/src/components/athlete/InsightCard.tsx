'use client';

/**
 * Phase 1 (plans/ui-redesign-v2.md §1) — `InsightCard`.
 *
 * Generalizes the Phase-0 structured analysis renderer
 * (`renderStructuredAnalysis`: score header → body → priority list →
 * collapsible method) to every domain. Unlike `AiAnalysisCard` it takes raw
 * markdown text instead of an `LlmAnalysis` row, so cycling / health /
 * lifting / event surfaces share one template. Unmatched markdown renders
 * exactly as before — no data is ever dropped.
 */

import React from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { SkeletonMetric } from '@/components/ui/Skeleton';
import { renderStructuredAnalysis } from '@/lib/analysisRenderer';

export interface InsightCardProps {
  title: React.ReactNode;
  /** Raw analysis markdown — rendered through the shared structured template. */
  bodyMarkdown?: string | null;
  isLoading?: boolean;
  isError?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  /** Optional footer (e.g. grounding chips, model + timestamp line). */
  footer?: React.ReactNode;
}

export function InsightCard({
  title,
  bodyMarkdown,
  isLoading,
  isError,
  emptyTitle = 'No insight yet',
  emptyDescription = 'Generate an analysis to see the structured breakdown here.',
  footer,
}: InsightCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      {isLoading ? (
        <div role="status" aria-label="Loading insight">
          <SkeletonMetric />
        </div>
      ) : isError ? (
        <p className="text-sm text-warning" role="alert">
          Insight failed to load.
        </p>
      ) : bodyMarkdown && bodyMarkdown.trim().length > 0 ? (
        <>
          <div className="rounded-lg border border-surface-light/50 bg-surface-light/30 p-4">
            {renderStructuredAnalysis(bodyMarkdown)}
          </div>
          {footer}
        </>
      ) : (
        <div className="py-4 text-center">
          <p className="text-sm text-muted">{emptyTitle}</p>
          <p className="mt-1 text-xs text-muted">{emptyDescription}</p>
        </div>
      )}
    </Card>
  );
}
