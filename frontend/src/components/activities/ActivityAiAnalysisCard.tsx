'use client';

import { AiAnalysisCard } from '@/components/analysis/AiAnalysisCard';
import { useAiAnalysis } from '@/lib/hooks/useAiAnalysis';

interface ActivityAiAnalysisCardProps {
  activityId: string;
}

export function ActivityAiAnalysisCard({ activityId }: ActivityAiAnalysisCardProps) {
  const { analysis, isLoading, isAnalyzing, isError, error, mutationError, onRefresh } =
    useAiAnalysis(
      ['activity-ai-analysis', activityId],
      `/api/v1/activities/${activityId}/ai-analysis`,
    );

  return (
    <AiAnalysisCard
      title="🤖 AI Ride Analysis"
      analysis={analysis}
      isLoading={isLoading}
      isRefreshing={isAnalyzing}
      onRefresh={onRefresh}
      buttonLabel="✨ Analyze with AI"
      buttonAriaLabel="Analyze ride with AI"
      emptyEmoji="🧠"
      emptyTitle="No AI analysis yet"
      emptyDescription='Click "Analyze with AI" to get AI-powered insights on this ride'
      analyzingText="Analyzing ride data with Gemini... This may take 10-20 seconds."
      mutationError={mutationError}
      queryError={isError && error instanceof Error ? error : null}
    />
  );
}
