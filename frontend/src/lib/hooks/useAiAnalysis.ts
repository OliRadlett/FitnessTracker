import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type { LlmAnalysis } from '@/lib/api';

/**
 * Shared hook for on-demand AI analysis (Gemini).
 * Encapsulates the common query + mutation pattern used by all
 * AI analysis cards (activity, session, health, event).
 *
 * - GET endpoint is cached with staleTime 30 min.
 * - POST endpoint triggers analysis and writes result to cache.
 */
export function useAiAnalysis(
  queryKey: readonly unknown[],
  endpoint: string,
) {
  const { authFetch, token } = useAuthFetch();
  const queryClient = useQueryClient();

  const { data: cachedAnalysis, isLoading, isError, error } = useQuery<LlmAnalysis | null>({
    queryKey,
    queryFn: () => authFetch<LlmAnalysis | null>(endpoint),
    staleTime: 1000 * 60 * 30, // 30 minutes
    enabled: !!token,
  });

  const mutation = useMutation({
    mutationFn: () => authFetch<LlmAnalysis>(endpoint, { method: 'POST' }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
    },
    onError: (err: Error) => {
      console.error(`[useAiAnalysis] Analysis failed for ${endpoint}:`, err);
    },
  });

  return {
    analysis: mutation.data ?? cachedAnalysis ?? null,
    isLoading,
    isAnalyzing: mutation.isPending,
    isError,
    error,
    mutationError: mutation.error instanceof Error ? mutation.error : null,
    onRefresh: () => mutation.mutate(),
  };
}
