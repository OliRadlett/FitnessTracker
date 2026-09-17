'use client';

import { AiAnalysisCard } from '@/components/analysis/AiAnalysisCard';
import type { LlmAnalysis } from '@/lib/api';
import { relativeTime } from '@/lib/analysisRenderer';
import { getActiveLocale } from '@/lib/utils';

interface LlmAnalysisCardProps {
  analysis: LlmAnalysis | null;
  isLoading: boolean;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export function LlmAnalysisCard({ analysis, isLoading, onRefresh, isRefreshing }: LlmAnalysisCardProps) {
  const subtitle = analysis ? (
    <>
      <span>
        📅 {new Date(analysis.analysis_date).toLocaleDateString(getActiveLocale(), {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })}
      </span>
      <span className="text-surface-light">|</span>
      <span>Model: <span className="text-muted font-mono">{analysis.model_used}</span></span>
      <span className="text-surface-light">|</span>
      <span>Last updated: {relativeTime(analysis.created_at)}</span>
    </>
  ) : null;

  return (
    <AiAnalysisCard
      title="🤖 AI Performance Analysis"
      analysis={analysis}
      isLoading={isLoading}
      isRefreshing={isRefreshing}
      onRefresh={onRefresh}
      buttonLabel="✨ Generate Analysis"
      buttonAriaLabel="Generate analysis"
      emptyEmoji="🧠"
      emptyTitle="No analysis generated yet"
      emptyDescription='Click "Generate Analysis" to get AI-powered insights on your cycling performance'
      subtitle={subtitle}
    />
  );
}
