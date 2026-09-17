'use client';

import { AiAnalysisCard } from '@/components/analysis/AiAnalysisCard';
import { useAiAnalysis } from '@/lib/hooks/useAiAnalysis';

export function HealthAiAnalysisCard() {
  const { analysis, isLoading, isAnalyzing, isError, error, mutationError, onRefresh } =
    useAiAnalysis(
      ['health-ai-analysis'],
      '/api/v1/metrics/health-ai-analysis',
    );

  return (
    <AiAnalysisCard
      title="🏥 AI Health Analysis"
      analysis={analysis}
      isLoading={isLoading}
      isRefreshing={isAnalyzing}
      onRefresh={onRefresh}
      buttonLabel="✨ Analyze Health"
      buttonAriaLabel="Analyze health data with AI"
      emptyEmoji="🩺"
      emptyTitle="No health analysis yet"
      emptyDescription='Click "Analyze Health" to get AI-powered insights on your HRV, sleep, recovery, and more'
      analyzingText="Analyzing health data with Gemini... This may take 10-20 seconds."
      mutationError={mutationError}
      queryError={isError && error instanceof Error ? error : null}
    />
  );
}
