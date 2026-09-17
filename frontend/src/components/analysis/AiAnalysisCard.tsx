'use client';

import React from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { SkeletonLine } from '@/components/ui/Skeleton';
import type { LlmAnalysis } from '@/lib/api';
import { renderAnalysisText, relativeTime } from '@/lib/analysisRenderer';

export interface AiAnalysisCardProps {
  /** Card title shown in the header */
  title: React.ReactNode;
  /** The analysis data, or null if not yet generated */
  analysis: LlmAnalysis | null;
  /** Whether the initial query is loading */
  isLoading: boolean;
  /** Whether the refresh mutation is in progress */
  isRefreshing: boolean;
  /** Trigger a refresh (re-analyze) */
  onRefresh: () => void;

  /** Button label when no analysis exists yet */
  buttonLabel?: string;
  /** Button aria-label when no analysis exists yet */
  buttonAriaLabel?: string;
  /** Emoji shown in the empty state */
  emptyEmoji?: string;
  /** Title text in the empty state */
  emptyTitle?: string;
  /** Description text in the empty state */
  emptyDescription?: string;
  /** Text shown in the analyzing spinner */
  analyzingText?: string;

  /** Optional subtitle (e.g. date) shown above the analysis content */
  subtitle?: React.ReactNode;
  /** Optional error from the mutation (renders warning box) */
  mutationError?: Error | null;
  /** Optional error from the query (renders warning box) */
  queryError?: Error | null;
}

const GEMINI_KEY_MSG = 'AI analysis is not available — GEMINI_API_KEY is not configured.';

export function AiAnalysisCard({
  title,
  analysis,
  isLoading,
  isRefreshing,
  onRefresh,
  buttonLabel = 'Analyze with AI',
  buttonAriaLabel = 'Analyze with AI',
  emptyEmoji = '🧠',
  emptyTitle = 'No AI analysis yet',
  emptyDescription = 'Click to generate an AI-powered analysis.',
  analyzingText = 'Analyzing with Gemini... This may take 10-20 seconds.',
  subtitle,
  mutationError,
  queryError,
}: AiAnalysisCardProps) {
  const buttonLabelRefresh = analysis ? 'Re-analyze' : buttonLabel;
  const buttonAriaLabelRefresh = analysis
    ? (buttonAriaLabel.replace(/Analyze.*/, 'Re-analyze') || 'Re-analyze')
    : buttonAriaLabel;
  const buttonLabelCurrent = isRefreshing ? '⏳ Analyzing...' : buttonLabelRefresh;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between w-full">
          <CardTitle>{title}</CardTitle>
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            aria-label={buttonAriaLabelRefresh}
            className="px-3 py-1.5 text-xs bg-accent/20 text-accent border border-accent/30 rounded-lg hover:bg-accent/30 transition-colors disabled:opacity-50"
          >
            {buttonLabelCurrent}
          </button>
        </div>
      </CardHeader>

      {/* Mutation error state */}
      {mutationError && (
        <div className="bg-warning/10 border border-warning/20 rounded-lg p-3 mb-4 mx-6">
          <p className="text-sm text-warning">
            {mutationError instanceof Error
              ? mutationError.message.includes('GEMINI_API_KEY')
                ? GEMINI_KEY_MSG
                : `Analysis failed: ${mutationError.message}`
              : 'Analysis failed. Please try again.'}
          </p>
        </div>
      )}

      {/* Query error state */}
      {queryError && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-warning text-sm mx-6 mb-4">
          Failed to load: {queryError.message}
        </div>
      )}

      {/* Loading skeleton */}
      {isLoading && !analysis && (
        <div className="space-y-3 px-6">
          <SkeletonLine width="75%" height="1rem" />
          <SkeletonLine width="100%" height="1rem" />
          <SkeletonLine width="92%" height="1rem" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !analysis && !isRefreshing && !mutationError && !queryError && (
        <div className="text-center py-6">
          <p className="text-3xl mb-2">{emptyEmoji}</p>
          <p className="text-muted text-sm">{emptyTitle}</p>
          <p className="text-muted text-xs mt-1">{emptyDescription}</p>
        </div>
      )}

      {/* Analyzing spinner */}
      {isRefreshing && (
        <div className="flex items-center gap-3 py-4 px-6">
          <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted">{analyzingText}</p>
        </div>
      )}

      {/* Analysis content */}
      {analysis && (
        <div className="px-6 pb-6">
          {subtitle && (
            <div className="flex items-center gap-3 mb-4 text-xs text-muted">
              {subtitle}
            </div>
          )}
          {!subtitle && (
            <div className="flex items-center gap-3 mb-4 text-xs text-muted">
              <span>Model: <span className="text-muted font-mono">{analysis.model_used}</span></span>
              <span className="text-surface-light">|</span>
              <span>Generated {relativeTime(analysis.created_at)}</span>
            </div>
          )}

          <div className="bg-surface-light/30 rounded-lg p-4 border border-surface-light/50">
            {renderAnalysisText(analysis.analysis_text)}
          </div>
        </div>
      )}
    </Card>
  );
}
