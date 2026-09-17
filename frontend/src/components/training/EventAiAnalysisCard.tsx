'use client';

import { AiAnalysisCard } from '@/components/analysis/AiAnalysisCard';
import { useAiAnalysis } from '@/lib/hooks/useAiAnalysis';

interface EventAiAnalysisCardProps {
  eventId: string;
}

export function EventAiAnalysisCard({ eventId }: EventAiAnalysisCardProps) {
  const { analysis, isLoading, isAnalyzing, isError, error, mutationError, onRefresh } =
    useAiAnalysis(
      ['event-ai-analysis', eventId],
      `/api/v1/events/${eventId}/ai-analysis`,
    );

  return (
    <AiAnalysisCard
      title="🏁 AI Event Preparation"
      analysis={analysis}
      isLoading={isLoading}
      isRefreshing={isAnalyzing}
      onRefresh={onRefresh}
      buttonLabel="✨ Race Prep AI"
      buttonAriaLabel="Get AI race preparation plan"
      emptyEmoji="🏁"
      emptyTitle="No race preparation analysis yet"
      emptyDescription='Click "Race Prep AI" to get a personalized taper plan, race-day strategy, and nutrition advice'
      analyzingText="Generating race preparation plan with Gemini... This may take 10-20 seconds."
      mutationError={mutationError}
      queryError={isError && error instanceof Error ? error : null}
    />
  );
}
