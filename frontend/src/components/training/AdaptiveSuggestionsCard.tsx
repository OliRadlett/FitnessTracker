import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getAdaptiveSuggestions, updatePlanDay, useAuthFetch } from '@/lib/api';
import type {
  AdaptiveAction,
  AdaptiveSuggestionsResponse,
} from '@/lib/api/types';

const STANCE_STYLES: Record<string, string> = {
  recover: 'border-orange-500/40 bg-orange-500/10 text-orange-300',
  rest: 'border-red-500/40 bg-red-500/10 text-red-300',
  ease: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  maintain: 'border-surface-light bg-surface-light/30 text-muted',
  build: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
};

const SEVERITY_DOTS: Record<string, string> = {
  info: 'bg-muted',
  warning: 'bg-amber-400',
  critical: 'bg-red-500',
};

interface AdaptiveSuggestionsCardProps {
  planId: string;
}

export function AdaptiveSuggestionsCard({ planId }: AdaptiveSuggestionsCardProps) {
  const { authFetch, token } = useAuthFetch();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['adaptive-suggestions', planId],
    queryFn: () => getAdaptiveSuggestions(authFetch, planId),
    staleTime: 5 * 60_000,
    enabled: !!token,
  });

  const applyAction = useMutation({
    mutationFn: (action: AdaptiveAction) =>
      updatePlanDay(authFetch, action.plan_id, action.day_id, action.fields),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plan-week', planId] });
      queryClient.invalidateQueries({ queryKey: ['plan-conformity', planId] });
      queryClient.invalidateQueries({ queryKey: ['adaptive-suggestions', planId] });
      queryClient.invalidateQueries({ queryKey: ['training-plan', planId] });
      queryClient.invalidateQueries({ queryKey: ['training-plans'] });
    },
    onError: (err: Error) => {
      console.error('[AdaptiveSuggestionsCard] Apply action failed:', err);
    },
  });

  if (query.isLoading || !query.data) {
    return null;
  }

  const data: AdaptiveSuggestionsResponse = query.data;
  if (!data.axes.length && !data.suggestions.length) {
    return null;
  }

  return (
    <div className="rounded-xl border border-surface-light bg-surface p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <h4 className="text-sm font-semibold text-white">Adaptive suggestions</h4>
        {data.fatigue && (
          <span className="text-xs uppercase tracking-wide text-muted">
            {data.fatigue}
          </span>
        )}
      </div>

      <p className="text-sm text-muted mb-3">{data.summary}</p>

      {data.axes.length > 0 && (
        <div className="space-y-2 mb-3">
          {data.axes.map((axis) => (
            <div
              key={axis.key}
              className={`rounded-lg border px-3 py-2 ${STANCE_STYLES[axis.stance] ?? STANCE_STYLES.maintain}`}
            >
              <div className="flex items-center gap-2">
                <span className={`h-1.5 w-1.5 rounded-full ${SEVERITY_DOTS[axis.severity] ?? 'bg-muted'}`} />
                <span className="text-xs font-semibold uppercase tracking-wider">
                  {axis.title}
                </span>
                <span className="text-xs capitalize opacity-80 ml-auto">{axis.stance}</span>
              </div>
              <p className="text-xs mt-1 opacity-90">{axis.guidance}</p>
            </div>
          ))}
        </div>
      )}

      {data.suggestions.length > 0 && (
        <div className="space-y-2">
          {data.suggestions.map((s, i) => (
            <div
              key={`${s.type}-${i}`}
              className="rounded-lg bg-surface-light/40 border border-surface-light/60 p-3"
            >
              <p className="text-xs font-semibold text-white">{s.title}</p>
              {s.detail && <p className="text-xs text-muted mt-1">{s.detail}</p>}
              {s.actions.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {s.actions.map((action) => (
                    <button
                      key={action.day_id + action.label}
                      type="button"
                      onClick={() => applyAction.mutate(action)}
                      disabled={applyAction.isPending}
                      className="px-2.5 py-1 text-xs rounded-lg bg-accent text-surface hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}