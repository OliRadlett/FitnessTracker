'use client';

import { AiAnalysisCard } from '@/components/analysis/AiAnalysisCard';
import { useAiAnalysis } from '@/lib/hooks/useAiAnalysis';

interface SessionAiAnalysisCardProps {
  sessionId: string;
}

export function SessionAiAnalysisCard({ sessionId }: SessionAiAnalysisCardProps) {
  const { analysis, isLoading, isAnalyzing, isError, error, mutationError, onRefresh } =
    useAiAnalysis(
      ['lifting-session-ai-analysis', sessionId],
      `/api/v1/lifting/sessions/${sessionId}/ai-analysis`,
    );

  return (
    <AiAnalysisCard
      title="🤖 AI Session Analysis"
      analysis={analysis}
      isLoading={isLoading}
      isRefreshing={isAnalyzing}
      onRefresh={onRefresh}
      buttonLabel="✨ Analyze with AI"
      buttonAriaLabel="Analyze session with AI"
      emptyEmoji="🧠"
      emptyTitle="No AI analysis yet"
      emptyDescription='Click "Analyze with AI" to get AI-powered insights on this lifting session'
      analyzingText="Analyzing session data with Gemini... This may take 10-20 seconds."
      mutationError={mutationError}
      queryError={isError && error instanceof Error ? error : null}
    />
  );
}
