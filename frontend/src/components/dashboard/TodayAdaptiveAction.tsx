'use client';

import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getAdaptiveSuggestions, updatePlanDay, useAuthFetch } from '@/lib/api';
import type {
  AdaptiveAction,
  AdaptiveSuggestionsResponse,
} from '@/lib/api';

// Suggestion types that carry one-tap day-level actions (see backend
// app/services/adaptive.py — derive_adaptive_advice + _actions_for).
const ACTIONABLE_TYPES = new Set(['rest_day', 'intensity_cut', 'intensity_raise']);

interface PlanDayRef {
  id: string;
  day_date: string;
}

interface TodayAdaptiveActionProps {
  planId: string;
  todayDayId?: string | null;
  todayDateStr: string;
  planDays?: PlanDayRef[];
  /** 'row' renders borderless for embedding in RestDayBanner; 'standalone'
   *  wraps in its own card for use when there is no banner. */
  variant?: 'row' | 'standalone';
}

function shortDateLabel(dateStr: string): string {
  // Noon anchor avoids TZ-day shifts for YYYY-MM-DD strings.
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function suggestionCopy(type: string, isToday: boolean, dateLabel: string): string {
  const when = isToday ? 'today' : dateLabel;
  if (type === 'rest_day') return `Suggested: rest ${when}`;
  if (type === 'intensity_cut') return `Suggested: cut ${when} 15%`;
  if (type === 'intensity_raise') return `Suggested: raise ${when} 8%`;
  return `Suggested: adjust ${when}`;
}

/**
 * QW3 — point-of-decision adaptive action on the Today tab.
 *
 * Fetches the same adaptive suggestions as AdaptiveSuggestionsCard
 * (shared ['adaptive-suggestions', planId] cache) and surfaces the single
 * action targeting today — or the next upcoming training day — as a compact
 * "Suggested: … — [Apply]" row. Renders nothing when there is no actionable
 * suggestion for today/upcoming days.
 *
 * Apply reuses the same updatePlanDay mutation as AdaptiveSuggestionsCard,
 * plus dashboard invalidations so the banner/plan refresh.
 */
export function TodayAdaptiveAction({
  planId,
  todayDayId,
  todayDateStr,
  planDays,
  variant = 'row',
}: TodayAdaptiveActionProps) {
  const { authFetch, token } = useAuthFetch();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['adaptive-suggestions', planId],
    queryFn: () => getAdaptiveSuggestions(authFetch, planId),
    staleTime: 5 * 60_000,
    enabled: !!token && !!planId,
  });

  // Same apply pattern as AdaptiveSuggestionsCard (lines ~38-51), extended
  // with the dashboard summary keys so the banner refreshes after apply.
  const applyAction = useMutation({
    mutationFn: (action: AdaptiveAction) =>
      updatePlanDay(authFetch, action.plan_id, action.day_id, action.fields),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plan-week'] });
      queryClient.invalidateQueries({ queryKey: ['plan-conformity'] });
      queryClient.invalidateQueries({ queryKey: ['adaptive-suggestions'] });
      queryClient.invalidateQueries({ queryKey: ['training-plan'] });
      queryClient.invalidateQueries({ queryKey: ['training-plans'] });
      queryClient.invalidateQueries({ queryKey: ['today-summary'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
    },
    onError: (err: Error) => {
      console.error('[TodayAdaptiveAction] Apply action failed:', err);
    },
  });

  const selected = React.useMemo(() => {
    const data: AdaptiveSuggestionsResponse | undefined = query.data;
    if (!data) return null;
    const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
    const candidates: { type: string; action: AdaptiveAction }[] = [];
    for (const s of suggestions) {
      if (!ACTIONABLE_TYPES.has(s.type) || s.actions.length === 0) continue;
      for (const action of s.actions) candidates.push({ type: s.type, action });
    }
    if (candidates.length === 0) return null;

    // Prefer the action targeting today's plan day (day-id match).
    if (todayDayId) {
      const todayMatch = candidates.find((c) => c.action.day_id === todayDayId);
      if (todayMatch) return { ...todayMatch, isToday: true, dateStr: todayDateStr };
    }

    // Otherwise the next upcoming training day (earliest date >= today).
    const dateById = new Map((planDays ?? []).map((d) => [d.id, d.day_date]));
    const upcoming = candidates
      .map((c) => ({ ...c, dateStr: dateById.get(c.action.day_id) }))
      .filter((c) => c.dateStr != null && c.dateStr >= todayDateStr)
      .sort((a, b) => (a.dateStr as string).localeCompare(b.dateStr as string));
    if (upcoming.length > 0) {
      const next = upcoming[0];
      return { ...next, isToday: next.dateStr === todayDateStr, dateStr: next.dateStr as string };
    }

    // No plan-week dates to match against (week not loaded) — the backend
    // orders upcoming days ascending, so the first action is the next
    // training day.
    return { ...candidates[0], isToday: false, dateStr: todayDateStr };
  }, [query.data, todayDayId, todayDateStr, planDays]);

  if (query.isLoading || !selected) return null;

  const label = suggestionCopy(
    selected.type,
    selected.isToday,
    shortDateLabel(selected.dateStr),
  );

  const row = (
    <div className="flex items-center justify-between gap-3 pt-2 mt-2 border-t border-white/5">
      <p className="text-sm text-foreground truncate">{label}</p>
      <button
        type="button"
        onClick={() => applyAction.mutate(selected.action)}
        disabled={applyAction.isPending}
        className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg bg-accent text-surface hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px] sm:min-h-0"
      >
        {applyAction.isPending ? 'Applying…' : 'Apply'}
      </button>
    </div>
  );

  if (applyAction.isError) {
    return variant === 'standalone' ? (
      <div className="rounded-xl border border-surface-light/50 bg-surface p-4">
        {row}
        <p className="text-xs text-warning mt-1">Couldn&apos;t apply — please try again.</p>
      </div>
    ) : (
      <div>
        {row}
        <p className="text-xs text-warning mt-1">Couldn&apos;t apply — please try again.</p>
      </div>
    );
  }

  if (variant === 'standalone') {
    return (
      <div className="rounded-xl border border-surface-light/50 bg-surface px-4 pb-3 pt-1">
        {row}
      </div>
    );
  }

  return row;
}
