'use client';

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch, deleteLiftingSession } from '@/lib/api';
import { useDeepLink } from '@/lib/useDeepLink';
import type {
  LiftingSession,
  PersonalRecord,
  CreateSessionPayload,
  CreatePRPayload,
  UpdateSessionPayload,
  ChartData,
  LinkedActivity,
  LiftingAnalysis,
  DeficiencyResponse,
  CyclingProfile,
} from '@/lib/api';
import { VolumeTrendChart } from '@/components/lifting/overview/VolumeTrendChart';
import { amount, bestPr, big3Total, previousSameFocus, shortWeight, topSet } from '@/lib/lifting/overview';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Modal, ModalHeader } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { LiftingTabs, type LiftingTab } from '@/components/lifting/LiftingTabs';
import { OverviewTab } from '@/components/lifting/overview/OverviewTab';
import { ChartBody } from '@/components/charts/Chart';
import { SkeletonRow } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { LinkActivityModal } from '@/components/lifting/LinkActivityModal';
import { WarmupTemplateManager } from '@/components/lifting/WarmupTemplateManager';
import { AddExerciseForm } from '@/components/lifting/AddExerciseForm';
import { ExerciseGroup } from '@/components/lifting/ExerciseGroup';
import { ExerciseProgressSection } from '@/components/lifting/ExerciseProgressSection';
import { SessionRail } from '@/components/lifting/SessionRail';
import { SetLadder } from '@/components/lifting/SetLadder';
import { PrTab } from '@/components/lifting/PrTab';
import { useSessionBrowserFilters } from '@/components/lifting/useSessionBrowserFilters';
import { SessionLabels } from '@/components/lifting/SessionLabels';
import { ManualPRForm } from '@/components/lifting/ManualPRForm';
import { RepeatSessionButton } from '@/components/lifting/RepeatSessionButton';
import { QuickAddSetBar } from '@/components/lifting/QuickAddSetBar';
import { RepRangeCard } from '@/components/lifting/RepRangeCard';
import { RpeDriftCard } from '@/components/lifting/RpeDriftCard';
import { CombinedLoadHero } from '@/components/lifting/overview/CombinedLoadHero';
import { formatDuration, getActiveLocale } from '@/lib/utils';
import { fromLocalInputValue, toLocalInputValue } from '@/lib/lifting/sessionTime';
import { useForecastChart } from '@/lib/projection';
import { usePageTitle } from '@/lib/usePageTitle';
import { LiftingAnalysisCard } from '@/components/lifting/LiftingAnalysisCard';
import { SessionAiAnalysisCard } from '@/components/lifting/SessionAiAnalysisCard';
import { PRCelebration, type PREvent } from '@/components/ui/PRCelebration';
import { Dumbbell, Link2, Clock, TriangleAlert, Pencil, Trash2, Zap } from 'lucide-react';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** "17:02 – 18:15 · 1h 13m" for live-tracked sessions, or "" when times are absent */
function formatSessionTimeRange(startedAt?: string | null, endedAt?: string | null, durationSeconds?: number | null): string {
  if (!startedAt) return '';
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString(getActiveLocale(), { hour: '2-digit', minute: '2-digit' });
  let range = fmt(startedAt);
  if (endedAt) range += ` – ${fmt(endedAt)}`;
  const duration =
    durationSeconds ??
    (endedAt
      ? Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000))
      : null);
  if (duration && duration > 0) range += ` · ${formatDuration(duration)}`;
  return range;
}

/** Group lifting sets by exercise name, preserving order of first appearance. */
function groupSetsByExercise(sets: { exercise_name: string }[]): Map<string, typeof sets> {
  const groups = new Map<string, typeof sets>();
  for (const set of sets) {
    const existing = groups.get(set.exercise_name);
    if (existing) {
      existing.push(set);
    } else {
      groups.set(set.exercise_name, [set]);
    }
  }
  return groups;
}

// ── Linked Activity Card ─────────────────────────────────────────────────────

function LinkedActivityCard({ activity, onUnlink }: { activity: LinkedActivity; onUnlink: () => void }) {
  return (
    <div className="p-3 bg-surface-light/40 rounded-lg border border-accent/20">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-orange-400 bg-orange-400/10 px-2 py-0.5 rounded">Strava</span>
          <Link
            href={`/activities?activity=${activity.id}`}
            className="text-sm font-medium text-foreground truncate max-w-[200px] hover:text-accent transition-colors"
            title="View in Activities"
          >
            {activity.name}
          </Link>
        </div>
        <button onClick={onUnlink} className="text-xs text-muted hover:text-warning transition-colors">
          Unlink
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
        {activity.duration_seconds && (
          <div>
            <span className="text-muted">Duration</span>
            <p className="text-foreground">{formatDuration(activity.duration_seconds)}</p>
          </div>
        )}
        {activity.average_heartrate && (
          <div>
            <span className="text-muted">Avg HR</span>
            <p className="text-warning">{Math.round(activity.average_heartrate)} bpm</p>
          </div>
        )}
        {activity.calories && (
          <div>
            <span className="text-muted">Calories</span>
            <p className="text-yellow-400">{Math.round(activity.calories)} kcal</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

const TAB_VALUES: LiftingTab[] = ['overview', 'sessions', 'analytics', 'prs'];

export default function LiftingPage() {
  usePageTitle('Lifting');
  const { authFetch, authFetchWithHeaders, token } = useAuthFetch();
  const queryClient = useQueryClient();
  const { setParam } = useDeepLink();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [showNewSession, setShowNewSession] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showManualPR, setShowManualPR] = useState(false);
  const [showAddExercise, setShowAddExercise] = useState(false);
  const [showEditSession, setShowEditSession] = useState(false);
  const editFormRef = useRef<HTMLDivElement>(null);
  const [confirmDeleteSession, setConfirmDeleteSession] = useState(false);
  const [selectedPRId, setSelectedPRId] = useState<string | null>(null);
  const [linkModalSessionId, setLinkModalSessionId] = useState<string | null>(null);
  const [celebrationPR, setCelebrationPR] = useState<PREvent | null>(null);

  // Tab URL state — syncs with `?tab=<name>` for deep-linking
  const [activeTab, setActiveTab] = useState<LiftingTab>('overview');

  // Deep-link: read tab + session/PR from URL once on mount. Reading through
  // `useDeepLink().getParam` re-ran this whenever `setParam` changed the URL,
  // and the still-present `?session=` then forced the tab back to Sessions —
  // a selected session made Overview/Analytics/PRs unreachable.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab') as LiftingTab | 'templates' | null;
    if (tab === 'templates') {
      setShowTemplates(true);
      setActiveTab('sessions');
    } else if (tab && TAB_VALUES.includes(tab)) {
      setActiveTab(tab);
    }
    const sessionId = params.get('session');
    if (sessionId) {
      setSelectedSessionId((prev) => (prev === sessionId ? prev : sessionId));
      if (tab !== 'sessions') setActiveTab('sessions');
    }
    const prId = params.get('pr');
    if (prId) {
      setSelectedPRId(prId);
      setActiveTab('prs');
    }
  }, []);

  const handleTabChange = useCallback(
    (tab: LiftingTab) => {
      setActiveTab(tab);
      setParam('tab', tab);
    },
    [setParam],
  );

  const handleSelectSession = useCallback((id: string | null) => {
    setSelectedSessionId(id);
    setParam('session', id);
  }, [setParam]);

  // Session browser filter state — one URL-synced (s_*) instance used by the
  // SessionRail search + focus chips. `?session=` / `?tab=` / `?pr=` are untouched.
  const browserFilterBag = useSessionBrowserFilters();

  // Mobile drill-down: selecting a session below the fold scrolls the detail
  // into view on <lg screens; desktop shows both panes side by side.
  const detailRef = useRef<HTMLDivElement>(null);
  const handleSelectSessionInBrowser = useCallback((id: string | null) => {
    handleSelectSession(id);
    setShowAddExercise(false);
    if (id != null && typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) {
      // Let selection render first, then bring the detail into view.
      window.setTimeout(() => detailRef.current?.scrollIntoView({ block: 'start' }), 50);
    }
  }, [handleSelectSession]);
  const previousPRsRef = useRef<Map<string, number>>(new Map());

  const [newSession, setNewSession] = useState<CreateSessionPayload>({
    session_date: new Date().toISOString().split('T')[0],
    focus: '',
    notes: '',
  });

  // ── Queries ──────────────────────────────────────────────────────────────

  // Full-list query retained for AutoregulationCard, Whoop banner, e1RM
  // options and chip facets; SessionRail filters it client-side.
  const {
    data: sessionsPage,
    isError: sessionsError,
    refetch: refetchSessions,
  } = useQuery<{ items: LiftingSession[]; total: number }>({
    // Distinct from the array-shaped ['lifting-sessions'] used by
    // AutoregulationCard / Live Lift / videos. Sharing that key with a
    // `{items,total}` payload breaks those consumers for the stale window.
    queryKey: ['lifting-sessions', 'page', 200],
    queryFn: async () => {
      const { data, headers } = await authFetchWithHeaders<LiftingSession[]>(
        '/api/v1/lifting/sessions?limit=200',
      );
      return {
        items: data,
        total: Number(headers.get('X-Total-Count') ?? data.length),
      };
    },
    enabled: !!token,
    staleTime: 60_000,  // 1 min
  });
  const sessions = sessionsPage?.items;
  const sessionsTotal = sessionsPage?.total ?? 0;

  const { data: strengthBalanceChart, isLoading: strengthBalanceLoading } = useQuery<ChartData>({
    queryKey: ['chart-strength-balance', 30],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/strength_balance'),
    enabled: !!token,
    staleTime: 300_000,
  });

  const { data: volIntChart, isLoading: volIntLoading } = useQuery<ChartData>({
    queryKey: ['chart-volume-intensity'],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/volume_intensity_periodization?weeks=26'),
    enabled: !!token,
    staleTime: 300_000,
  });

  const { data: weeklyVolumeChart } = useQuery<ChartData>({
    queryKey: ['chart-weekly-volume', 16],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/weekly_volume?weeks=16'),
    enabled: !!token,
    staleTime: 300_000,
  });

  // Jev session-label charts — populated by the weekly classification backfill.
  const { data: sessionMixChart, isLoading: sessionMixLoading } = useQuery<ChartData>({
    queryKey: ['chart-session-mix', 26],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/session_class_mix?weeks=26'),
    enabled: !!token,
    staleTime: 300_000,
  });

  const { data: liftFrequencyChart, isLoading: liftFrequencyLoading } = useQuery<ChartData>({
    queryKey: ['chart-lift-frequency', 12],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/lift_frequency?weeks=12'),
    enabled: !!token,
    staleTime: 300_000,
  });

  // Estimated 1RM history — exercise selector mirrors ExerciseProgressSection:
  // options derived from loaded sessions, auto-selects the first exercise.
  const e1rmExerciseList = useMemo(() => {
    if (!sessions) return [];
    const names = new Set<string>();
    for (const session of sessions) {
      for (const set of session.sets || []) {
        names.add(set.exercise_name);
      }
    }
    return Array.from(names).sort();
  }, [sessions]);
  const [selectedE1rmExercise, setSelectedE1rmExercise] = useState('');
  const effectiveE1rmExercise = selectedE1rmExercise || e1rmExerciseList[0] || '';

  const { data: e1rmHistoryChart, isLoading: e1rmHistoryLoading } = useQuery<ChartData>({
    queryKey: ['chart-estimated-1rm-history', effectiveE1rmExercise],
    queryFn: () => authFetch<ChartData>(
      `/api/v1/charts/estimated_1rm_history?exercise_name=${encodeURIComponent(effectiveE1rmExercise)}`
    ),
    enabled: !!effectiveE1rmExercise && !!token,
    staleTime: 300_000,
  });

  const { data: sessionDetail, isLoading: sessionDetailLoading, isError: sessionDetailError, refetch: refetchSessionDetail } = useQuery<LiftingSession>({
    queryKey: ['lifting-session', selectedSessionId],
    queryFn: () => authFetch<LiftingSession>(`/api/v1/lifting/sessions/${selectedSessionId}`),
    enabled: !!selectedSessionId && !!token,
  });

  const { data: sessionAnalysis } = useQuery<LiftingAnalysis>({
    queryKey: ['lifting-analysis', selectedSessionId],
    queryFn: () => authFetch<LiftingAnalysis>(`/api/v1/lifting/sessions/${selectedSessionId}/analysis`),
    enabled: !!selectedSessionId && !!token,
  });

  const { data: cyclingProfile } = useQuery<CyclingProfile>({
    queryKey: ['cycling-profile'],
    queryFn: () => authFetch<CyclingProfile>('/api/v1/cycling/profile'),
    enabled: !!token,
    staleTime: 300_000,
  });
  const bodyweightKg = cyclingProfile?.weight_kg ?? null;

  const { data: personalRecords, isLoading: prLoading } = useQuery<PersonalRecord[]>({
    queryKey: ['personal-records'],
    queryFn: () => authFetch<PersonalRecord[]>('/api/v1/lifting/prs'),
    enabled: !!token,
    staleTime: 300_000,  // 5 min — PRs change rarely
  });

  // PRs achieved per session (for card-level PR badges)
  const prsBySession = useMemo(() => {
    const map = new Map<string, PersonalRecord[]>();
    for (const pr of personalRecords ?? []) {
      if (pr.session_id) {
        const key = pr.session_id.toString();
        const arr = map.get(key) ?? [];
        arr.push(pr);
        map.set(key, arr);
      }
    }
    return map;
  }, [personalRecords]);

  const { data: deficiency, isLoading: deficiencyLoading } = useQuery<DeficiencyResponse>({
    queryKey: ['deficiency'],
    queryFn: () => authFetch<DeficiencyResponse>('/api/v1/deficiency?weeks=8'),
    enabled: !!token,
    staleTime: 600_000,  // 10 min — expensive server-side computation
  });

  // ── PR Celebration Detection ────────────────────────────────────────────
  // Track PR changes and trigger celebration when a PR improves
  useEffect(() => {
    if (!personalRecords) return;

    const currentMap = new Map<string, number>();
    for (const pr of personalRecords) {
      if (pr.record_type === '1rm' && pr.estimated_1rm) {
        const existing = currentMap.get(pr.exercise_name);
        if (!existing || pr.estimated_1rm > existing) {
          currentMap.set(pr.exercise_name, pr.estimated_1rm);
        }
      }
    }

    // Only detect changes after we have a previous snapshot (skip first load)
    if (previousPRsRef.current.size > 0) {
      for (const [exercise, new1rm] of currentMap.entries()) {
        const prev1rm = previousPRsRef.current.get(exercise);
        if (prev1rm !== undefined && new1rm > prev1rm) {
          const improvementPct = ((new1rm - prev1rm) / prev1rm) * 100;
           setCelebrationPR({
             type: 'lifting',
             exercise_name: exercise,
             new_1rm: new1rm,
             previous_1rm: prev1rm,
             improvement_pct: improvementPct,
           });
          break; // celebrate one at a time
        } else if (prev1rm === undefined) {
          // Brand new exercise PR
           setCelebrationPR({
             type: 'lifting',
             exercise_name: exercise,
             new_1rm: new1rm,
             previous_1rm: null,
             improvement_pct: null,
           });
          break;
        }
      }
    }

    previousPRsRef.current = currentMap;
  }, [personalRecords]);

  const [actionError, setActionError] = useState<string | null>(null);

  // ── Mutations ────────────────────────────────────────────────────────────

  const createPRMutation = useMutation({
    mutationFn: (payload: CreatePRPayload) =>
      authFetch<PersonalRecord>('/api/v1/lifting/prs', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personal-records'] });
      setShowManualPR(false);
    },
    onError: (err: Error) => setActionError(err.message || 'Failed to create PR'),
  });

  const createSessionMutation = useMutation({
    mutationFn: (payload: CreateSessionPayload) =>
      authFetch<LiftingSession>('/api/v1/lifting/sessions', { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: (newSession) => {
      queryClient.invalidateQueries({ queryKey: ['lifting-sessions'] });
      setShowNewSession(false);
      handleSelectSession(newSession.id);
      setNewSession({ session_date: new Date().toISOString().split('T')[0], focus: '', notes: '' });
    },
    onError: (err: Error) => setActionError(err.message || 'Failed to create session'),
  });

  const unlinkMutation = useMutation({
    mutationFn: (sessionId: string) =>
      authFetch<LiftingSession>(`/api/v1/lifting/sessions/${sessionId}/link`, {
        method: 'PUT',
        body: JSON.stringify({ activity_id: null }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lifting-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['lifting-session', selectedSessionId] });
    },
    onError: (err: Error) => setActionError(err.message || 'Failed to unlink activity'),
  });

  const backfillMutation = useMutation({
    mutationFn: () => authFetch<{ linked_count: number }>('/api/v1/lifting/backfill-links', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lifting-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['lifting-session', selectedSessionId] });
    },
    onError: (err: Error) => setActionError(err.message || 'Failed to backfill links'),
  });

  const updateSetMutation = useMutation({
    mutationFn: ({ setId, data }: { setId: string; data: Record<string, unknown> }) =>
      authFetch<LiftingSession>(`/api/v1/lifting/sets/${setId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lifting-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['lifting-session', selectedSessionId] });
      queryClient.invalidateQueries({ queryKey: ['lifting-volume'] });
    },
    onError: (err: Error) => setActionError(err.message || 'Failed to update set'),
  });

  const deleteSetMutation = useMutation({
    mutationFn: (setId: string) =>
      authFetch<void>(`/api/v1/lifting/sets/${setId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lifting-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['lifting-session', selectedSessionId] });
      queryClient.invalidateQueries({ queryKey: ['lifting-volume'] });
    },
    onError: (err: Error) => setActionError(err.message || 'Failed to delete set'),
  });

  const updateSessionMutation = useMutation({
    mutationFn: ({ sessionId, data }: { sessionId: string; data: UpdateSessionPayload }) =>
      authFetch<LiftingSession>(`/api/v1/lifting/sessions/${sessionId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lifting-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['lifting-session', selectedSessionId] });
    },
    onError: (err: Error) => setActionError(err.message || 'Failed to update session'),
  });

  // Blur-save for the session start/finish times. Empty clears the field
  // (sends null); a finish at/before the start is rejected client-side.
  const handleSessionTimeBlur = useCallback((field: 'started_at' | 'ended_at', value: string) => {
    if (!sessionDetail || !selectedSessionId) return;
    if (value !== '' && fromLocalInputValue(value) === null) {
      setActionError('Enter a valid date and time');
      return;
    }
    const iso = fromLocalInputValue(value);
    const otherRaw = field === 'started_at' ? sessionDetail.ended_at : sessionDetail.started_at;
    const thisRaw = iso ?? (field === 'started_at' ? sessionDetail.started_at : sessionDetail.ended_at);
    if (thisRaw && otherRaw) {
      const thisMs = new Date(thisRaw).getTime();
      const otherMs = new Date(otherRaw).getTime();
      const startMs = field === 'started_at' ? thisMs : otherMs;
      const endMs = field === 'started_at' ? otherMs : thisMs;
      if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs <= startMs) {
        setActionError('Finish time must be after start time');
        return;
      }
    }
    updateSessionMutation.mutate({ sessionId: selectedSessionId, data: { [field]: iso } });
  }, [sessionDetail, selectedSessionId, updateSessionMutation]);

  const deleteSessionMutation = useMutation({
    mutationFn: (sessionId: string) => deleteLiftingSession(authFetch, sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lifting-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['personal-records'] });
      handleSelectSession(null);
      setConfirmDeleteSession(false);
    },
    onError: (err: Error) => setActionError(err.message || 'Failed to delete session'),
  });

  // Compute exercise groups for detail view
  const exerciseGroups = sessionDetail?.sets ? groupSetsByExercise(sessionDetail.sets) : new Map();

  // Desktop default selection: the newest session, so the detail pane is never
  // an empty placeholder. Mobile keeps the list-first drill-down.
  useEffect(() => {
    if (selectedSessionId || !sessions?.length) return;
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches) {
      setSelectedSessionId(sessions[0].id);
    }
  }, [sessions, selectedSessionId]);

  // The edit panel opens under the header; bring it into view so the pencil
  // action has an obvious result even when the detail is scrolled.
  useEffect(() => {
    if (!showEditSession) return;
    const timer = window.setTimeout(
      () => editFormRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
      60,
    );
    return () => window.clearTimeout(timer);
  }, [showEditSession]);

  // Previous same-focus session — the delta basis for the set ladder.
  const previousSession = useMemo(
    () => (sessionDetail ? previousSameFocus(sessionDetail, sessions ?? []) : null),
    [sessionDetail, sessions],
  );

  // Analytics heroes — derived once, from the same PR/session data the tabs use.
  const big3Cards = ['Back Squat', 'Bench Press', 'Deadlift'].map((name) => ({
    name,
    pr: bestPr(personalRecords ?? [], name),
  }));
  const big3TotalValue = big3Total(personalRecords ?? []);
  const weeklyVolumeValues = (weeklyVolumeChart?.series[0]?.data ?? [])
    .slice(-10)
    .map((v) => Number(v ?? 0));
  const weeklyVolumeLabels = (weeklyVolumeChart?.labels ?? [])
    .slice(-10)
    .map((d) => {
      const date = new Date(`${d}T12:00:00`);
      return Number.isNaN(date.getTime()) ? d : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    });

  return (
    <div className="space-y-6">
      {/* PR Celebration Toast */}
      <PRCelebration pr={celebrationPR} onDismiss={() => setCelebrationPR(null)} />

      {/* Error banner */}
      {actionError && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-warning text-sm">
          <span>{actionError}</span>
          <button
            onClick={() => setActionError(null)}
            className="shrink-0 text-warning hover:text-warning/80"
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}

      {/* Header */}
      <div className="pr-0 lg:pr-12">
        <PageHeader
          title="Lifting"
        subtitle={sessionsPage ? `${sessionsTotal} sessions · strength, tracked` : 'Strength, tracked'}
        actions={
          <>
            <button
              onClick={() => backfillMutation.mutate()}
              disabled={backfillMutation.isPending}
              className="hidden 2xl:inline-flex min-h-[44px] px-4 py-2 bg-surface-light hover:bg-surface text-muted hover:text-foreground text-sm font-medium rounded-lg transition-colors border border-surface-light disabled:opacity-50"
              title="Auto-link Strava strength activities to lifting sessions"
            >
              {backfillMutation.isPending ? 'Linking...' : (
                <span className="inline-flex items-center gap-1.5">
                  <Link2 className="w-4 h-4" aria-hidden />Auto-Link Strava
                </span>
              )}
            </button>
            <button
              onClick={() => setShowTemplates(true)}
              className="hidden sm:inline-flex min-h-[44px] px-4 py-2 bg-surface-light hover:bg-surface text-muted hover:text-foreground text-sm font-medium rounded-lg transition-colors border border-surface-light"
            >
              Templates
            </button>
            <Link
              href="/lifting/live"
              className="inline-flex min-h-[44px] items-center gap-1.5 px-5 py-2 bg-surface-light hover:bg-surface text-muted hover:text-foreground text-sm font-medium rounded-lg transition-colors border border-surface-light"
            >
              <Zap className="h-4 w-4 sm:hidden" aria-hidden />
              <span className="sm:hidden">Live</span>
              <span className="hidden sm:inline">Start live</span>
            </Link>
            <button
              onClick={() => {
                if (!showNewSession) {
                  setActiveTab('sessions');
                  setParam('tab', 'sessions');
                }
                setShowNewSession(!showNewSession);
              }}
              className="min-h-[44px] px-4 py-2 bg-accent hover:bg-accent-hover text-white font-medium rounded-lg transition-colors"
            >
              {showNewSession ? 'Cancel' : '+ New Session'}
            </button>
          </>
        }
      />
      </div>

      {sessionsError && (
        <ErrorState
          title="Couldn't load lifting sessions"
          message="Check your connection and try again."
          onRetry={() => refetchSessions()}
        />
      )}

      {/* Tab bar */}
      <LiftingTabs value={activeTab} onChange={handleTabChange} />

      {/* ── Overview Tab ─────────────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <OverviewTab
          sessions={sessions ?? []}
          prs={personalRecords ?? []}
          weeklyVolumeChart={weeklyVolumeChart}
          isLoading={!sessionsPage && !sessionsError}
          onOpenSession={(id) => {
            setActiveTab('sessions');
            setSelectedSessionId(id);
            setParam('tab', 'sessions');
            setParam('session', id);
          }}
          onOpenSessions={() => handleTabChange('sessions')}
          onLogSession={() => {
            setActiveTab('sessions');
            setShowNewSession(true);
            setParam('tab', 'sessions');
          }}
          onAnalytics={() => handleTabChange('analytics')}
        />
      )}

      {/* ── Sessions Tab ──────────────────────────────────────────────────────── */}
      {activeTab === 'sessions' && (
        <div className="space-y-6">

      {/* Backfill result */}
      {backfillMutation.isSuccess && backfillMutation.data && (
        <div className="p-3 bg-positive/10 border border-positive/30 rounded-lg text-sm text-positive" role="status" aria-live="polite">
          Linked {backfillMutation.data.linked_count} Strava activities to lifting sessions
        </div>
      )}
      {backfillMutation.isError && (
        <div className="p-3 bg-warning/10 border border-warning/30 rounded-lg text-sm text-warning flex items-center justify-between gap-3" role="alert">
          <span>Couldn&apos;t link Strava activities — try again.</span>
          <button
            onClick={() => backfillMutation.mutate()}
            className="shrink-0 font-medium underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* New Session Form */}
      {showNewSession && (
        <Card>
          <CardHeader><CardTitle>New Lifting Session</CardTitle></CardHeader>
          <form
            onSubmit={(e) => { e.preventDefault(); createSessionMutation.mutate(newSession); }}
            className="space-y-4"
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-muted mb-1">Date *</label>
                <input
                  type="date"
                  value={newSession.session_date}
                  onChange={(e) => setNewSession({ ...newSession, session_date: e.target.value })}
                  className="w-full bg-surface-light border border-surface-light text-foreground text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Focus</label>
                <input
                  type="text"
                  placeholder="e.g. Upper Body, Legs, Push"
                  value={newSession.focus || ''}
                  onChange={(e) => setNewSession({ ...newSession, focus: e.target.value })}
                  className="w-full bg-surface-light border border-surface-light text-foreground text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Notes</label>
                <input
                  type="text"
                  placeholder="Optional notes"
                  value={newSession.notes || ''}
                  onChange={(e) => setNewSession({ ...newSession, notes: e.target.value })}
                  className="w-full bg-surface-light border border-surface-light text-foreground text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={createSessionMutation.isPending}
              className="px-6 py-2 bg-accent hover:bg-accent-hover text-white font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {createSessionMutation.isPending ? 'Creating...' : 'Create Session'}
            </button>
            {createSessionMutation.isError && <p className="text-warning text-sm" role="alert" aria-live="assertive">Failed to create session</p>}
          </form>
        </Card>
      )}

      {/* Sessions + Detail */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Compact, month-grouped rail (replaces the 190px card grid) */}
        <div className="lg:col-span-1">
          <SessionRail
            sessions={sessions ?? []}
            total={sessionsTotal}
            selectedId={selectedSessionId}
            onSelect={handleSelectSessionInBrowser}
            prsBySession={prsBySession}
            filterBag={browserFilterBag}
          />
        </div>

        {/* Session Detail */}
        <div className="lg:col-span-2 scroll-mt-4" ref={detailRef}>
          {selectedSessionId && (
            <button
              onClick={() => handleSelectSession(null)}
              className="lg:hidden mb-3 inline-flex items-center gap-1 min-h-[44px] px-3 text-sm text-muted hover:text-foreground rounded-lg transition-colors"
              aria-label="Back to sessions list"
            >
              ← Sessions
            </button>
          )}
          {selectedSessionId && sessionDetail ? (
            <div className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{sessionDetail.focus?.trim() || 'Session'}</CardTitle>
                    <p className="text-sm text-muted mt-1 flex items-center gap-1 flex-wrap">
                      <span>{new Date(sessionDetail.session_date).toLocaleDateString(getActiveLocale())}</span>
                      {(() => {
                        const range = formatSessionTimeRange(sessionDetail.started_at, sessionDetail.ended_at, sessionDetail.duration_seconds);
                        if (!range) return null;
                        return (
                          <span className="inline-flex items-center gap-1">
                            <span aria-hidden="true">·</span>
                            <Clock className="w-3.5 h-3.5" aria-hidden />
                            {range}
                          </span>
                        );
                      })()}
                      {sessionDetail.notes && <span>· {sessionDetail.notes}</span>}
                    </p>
                    {sessionDetail.ai_tags && (
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        {sessionDetail.ai_tags.outcome && (
                          <span
                            className="text-xs px-2 py-0.5 rounded-full bg-surface-light text-muted"
                            title="Jev-inferred session outcome"
                          >
                            {sessionDetail.ai_tags.outcome}
                          </span>
                        )}
                        {typeof sessionDetail.ai_tags.energy === 'number' && (
                          <span
                            className="text-xs px-2 py-0.5 rounded-full bg-surface-light text-muted"
                            title="Jev-inferred energy (0 low – 2 high)"
                          >
                            energy {sessionDetail.ai_tags.energy}
                          </span>
                        )}
                        {typeof sessionDetail.ai_tags.pain_injury === 'number' &&
                          sessionDetail.ai_tags.pain_injury >= 0.5 && (
                            <span
                              className="text-xs px-2 py-0.5 rounded-full bg-warning/15 text-warning"
                              title="Jev detected a pain/injury mention in the notes"
                            >
                              <TriangleAlert className="w-3 h-3 inline mr-0.5" aria-hidden />
                              pain mention
                            </span>
                          )}
                        {typeof sessionDetail.ai_tags.high_fatigue === 'number' &&
                          sessionDetail.ai_tags.high_fatigue >= 0.5 && (
                            <span
                              className="text-xs px-2 py-0.5 rounded-full bg-warning/15 text-warning"
                              title="Jev detected unusual fatigue in the notes"
                            >
                              fatigue
                            </span>
                          )}
                        {typeof sessionDetail.ai_tags.pr_mention === 'number' &&
                          sessionDetail.ai_tags.pr_mention >= 0.5 && (
                            <span
                              className="text-xs px-2 py-0.5 rounded-full bg-positive/15 text-positive"
                              title="Jev detected a PR mention in the notes"
                            >
                              PR
                            </span>
                          )}
                      </div>
                    )}
                    <SessionLabels
                      split={sessionDetail.session_split}
                      lift={sessionDetail.session_lift}
                      sessionClass={sessionDetail.session_class}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <RepeatSessionButton
                      session={sessionDetail}
                      onDuplicated={(created) => handleSelectSession(created.id)}
                      variant="icon"
                    />
                    <button
                      onClick={() => setShowEditSession(!showEditSession)}
                      className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-light/40 hover:text-accent"
                      aria-label="Edit session"
                      title="Edit session"
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </button>
                    {confirmDeleteSession ? (
                      <div className="flex gap-1">
                        <button
                          onClick={() => deleteSessionMutation.mutate(selectedSessionId)}
                          disabled={deleteSessionMutation.isPending}
                          className="text-xs text-white bg-warning/80 hover:bg-warning px-2 py-1 rounded disabled:opacity-50"
                        >
                          Delete
                        </button>
                        <button onClick={() => setConfirmDeleteSession(false)} className="text-xs text-muted hover:text-foreground px-2 py-1">Cancel</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteSession(true)}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-light/40 hover:text-warning"
                        aria-label="Delete session"
                        title="Delete session"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    )}
                    <button
                      onClick={() => setShowAddExercise(!showAddExercise)}
                      className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      {showAddExercise ? 'Cancel' : '+ Add Exercise'}
                    </button>
                  </div>
                </div>
              </CardHeader>

              {/* Summary strip — the four numbers read before the sets */}
              <div className="mb-4 grid grid-cols-2 gap-x-3 gap-y-3 rounded-lg border border-surface-light/50 bg-background/30 p-3 sm:grid-cols-4 sm:p-4">
                <div>
                  <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">Volume</p>
                  <p className="mt-1 text-[20px] font-semibold leading-none">{shortWeight(sessionDetail.total_volume_kg)}</p>
                </div>
                <div>
                  <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">Sets</p>
                  <p className="mt-1 text-[20px] font-semibold leading-none">{sessionDetail.sets.length}</p>
                </div>
                <div>
                  <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">Top set</p>
                  <p className="mt-1 text-[20px] font-semibold leading-none">
                    {topSet(sessionDetail) ? `${amount(topSet(sessionDetail)!.weight_kg)}×${topSet(sessionDetail)!.reps}` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">TSS</p>
                  <p className="mt-1 text-[20px] font-semibold leading-none">
                    {sessionDetail.estimated_tss ? Math.round(sessionDetail.estimated_tss) : '—'}
                  </p>
                </div>
              </div>

              {/* Edit Session Form — directly under the summary, above the ladder */}
              {showEditSession && (
                <div
                  key={selectedSessionId ?? 'edit'}
                  ref={editFormRef}
                  className="mb-4 rounded-lg border border-accent/40 bg-surface-light/30 p-4"
                  aria-label="Edit session"
                >
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-accent">Edit session</p>
                      <p className="mt-0.5 text-[12px] text-muted">Changes save when you leave each field.</p>
                    </div>
                    <button
                      onClick={() => setShowEditSession(false)}
                      className="inline-flex h-11 items-center rounded-lg px-3 text-[13px] font-medium text-muted hover:bg-surface-light/40 hover:text-foreground"
                    >
                      Done
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div>
                      <label className="block text-xs text-muted mb-1">Date</label>
                      <input
                        type="date"
                        defaultValue={sessionDetail.session_date}
                        onBlur={(e) => updateSessionMutation.mutate({ sessionId: selectedSessionId, data: { session_date: e.target.value } })}
                        className="w-full bg-surface-light border border-surface-light text-foreground text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-muted mb-1">Focus</label>
                      <input
                        type="text"
                        defaultValue={sessionDetail.focus || ''}
                        onBlur={(e) => updateSessionMutation.mutate({ sessionId: selectedSessionId, data: { focus: e.target.value || null } })}
                        placeholder="e.g. Upper Body"
                        className="w-full bg-surface-light border border-surface-light text-foreground text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-muted mb-1">Notes</label>
                      <input
                        type="text"
                        defaultValue={sessionDetail.notes || ''}
                        onBlur={(e) => updateSessionMutation.mutate({ sessionId: selectedSessionId, data: { notes: e.target.value || null } })}
                        placeholder="Optional notes"
                        className="w-full bg-surface-light border border-surface-light text-foreground text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-muted mb-1">Started</label>
                      <input
                        type="datetime-local"
                        key={`started-${selectedSessionId}`}
                        defaultValue={toLocalInputValue(sessionDetail.started_at)}
                        onBlur={(e) => handleSessionTimeBlur('started_at', e.target.value)}
                        title="Session start time — clearing the field removes it"
                        className="w-full bg-surface-light border border-surface-light text-foreground text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-muted mb-1">Finished</label>
                      <input
                        type="datetime-local"
                        key={`ended-${selectedSessionId}`}
                        defaultValue={toLocalInputValue(sessionDetail.ended_at)}
                        onBlur={(e) => handleSessionTimeBlur('ended_at', e.target.value)}
                        title="Session finish time — clearing the field removes it"
                        className="w-full bg-surface-light border border-surface-light text-foreground text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
                      />
                    </div>
                  </div>
                  <div className="mt-2 min-h-[18px] text-[12px]" aria-live="polite">
                    {updateSessionMutation.isPending && <span className="text-muted">Saving…</span>}
                    {updateSessionMutation.isError && (
                      <span role="alert" className="text-warning">
                        Couldn&apos;t save — {updateSessionMutation.error instanceof Error ? updateSessionMutation.error.message : 'try again.'}
                      </span>
                    )}
                    {updateSessionMutation.isSuccess && !updateSessionMutation.isPending && (
                      <span className="text-positive">Saved</span>
                    )}
                  </div>
                </div>
              )}

              {/* Set ladder — read-only review layer, separate from logging/editing */}
              {sessionDetail.sets && sessionDetail.sets.length > 0 && (
                <div className="mb-4 rounded-lg border border-surface-light/50 p-3 sm:p-4">
                  <SetLadder session={sessionDetail} previous={previousSession} />
                </div>
              )}

              {/* Linked Strava Activity */}
              {sessionDetail.linked_activity ? (
                <div className="mb-4">
                  <LinkedActivityCard
                    activity={sessionDetail.linked_activity}
                    onUnlink={() => unlinkMutation.mutate(selectedSessionId)}
                  />
                </div>
              ) : (
                <div className="mb-4">
                  <button
                    onClick={() => setLinkModalSessionId(selectedSessionId)}
                    className="text-sm text-accent hover:text-accent-hover transition-colors flex items-center gap-1"
                  >
                    <Link2 className="w-4 h-4" aria-hidden /> Link Strava activity
                  </button>
                </div>
              )}

              {/* Add Exercise Form */}
              {showAddExercise && (
                <div className="mb-4">
                  <AddExerciseForm
                    sessionId={selectedSessionId}
                    onDone={() => setShowAddExercise(false)}
                  />
                </div>
              )}

              {/* Exercise Groups — action surface, collapsed under the ladder */}
              <details className="mt-2">
                <summary className="flex min-h-[44px] cursor-pointer items-center text-[13px] font-medium text-muted hover:text-foreground">
                  Edit sets
                </summary>
                <div className="mt-3">
              {exerciseGroups.size > 0 ? (
                <div className="space-y-3">
                  {Array.from(exerciseGroups.entries()).map(([exerciseName, sets]) => (
                    <ExerciseGroup
                      key={exerciseName}
                      exerciseName={exerciseName}
                      sets={sets}
                      onUpdateSet={(setId, data) => updateSetMutation.mutate({ setId, data })}
                      onDeleteSet={(setId) => deleteSetMutation.mutate(setId)}
                      isUpdating={updateSetMutation.isPending}
                      isDeleting={deleteSetMutation.isPending}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-muted text-center py-8">No exercises yet. Add your first exercise above.</p>
              )}
                </div>
              </details>
            </Card>

            {/* Set ladder lives inside the detail card, above the edit table. */}

            {/* Static Session Analysis */}
            {sessionAnalysis && (
              <div className="mt-6">
                <LiftingAnalysisCard analysis={sessionAnalysis} />
              </div>
            )}

            {/* AI Session Analysis */}
            <div className="mt-6">
              <SessionAiAnalysisCard sessionId={selectedSessionId} />
            </div>

            {/* Quick-add: one-line set logging, sticky at the detail bottom */}
            <div className="mt-6">
              <QuickAddSetBar session={sessionDetail} />
            </div>
            </div>
          ) : selectedSessionId && (sessionDetailLoading || !sessionDetailError) ? (
            <div className="space-y-3" aria-label="Loading session detail">
              <SkeletonRow />
              <SkeletonRow className="h-40" />
            </div>
          ) : selectedSessionId ? (
            <ErrorState
              title="Couldn't load session"
              message="Check your connection and try again."
              onRetry={() => refetchSessionDetail()}
            />
          ) : (
            <EmptyState
              icon={<Dumbbell className="w-8 h-8 text-muted" />}
              title="No session selected"
              description="Pick a session from the list to see its sets, analysis, and actions."
              action={{ label: '+ New session', onClick: () => setShowNewSession(true) }}
            />
          )}
        </div>
      </div>
        </div>
      )}

      {/* ── Templates Tab ─────────────────────────────────────────────────────── */}
      {/* Templates are a modal now — no top-level tab. */}

      {/* ── PRs Tab ───────────────────────────────────────────────────────────── */}
      {activeTab === 'prs' && (
        <PrTab
          prs={personalRecords ?? []}
          bodyweightKg={bodyweightKg}
          isLoading={prLoading}
          selectedPRId={selectedPRId}
          // Manual PR entry has no page-level form after the legacy block was
          // removed; kept as a no-op so PrTab's required prop stays satisfied.
          onAddPR={() => setShowManualPR(true)}
          onOpenSession={(id) => {
            setActiveTab('sessions');
            setSelectedSessionId(id);
            setParam('tab', 'sessions');
            setParam('session', id);
          }}
          deficiency={deficiency}
          deficiencyLoading={deficiencyLoading}
        />
      )}

      {/* ── Analytics Tab ──────────────────────────────────────────────────────── */}
      {activeTab === 'analytics' && (
        <div className="space-y-6">

      {/* Three heroes: volume, Big-3 PRs, combined load */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle>Weekly volume</CardTitle>
                <p className="mt-0.5 text-[12px] text-muted">{shortWeight(weeklyVolumeValues[weeklyVolumeValues.length - 1] ?? 0)} latest week</p>
              </div>
              <span className="rounded-md bg-accent/12 px-1.5 py-1 text-[12px] font-medium text-accent">kg</span>
            </div>
          </CardHeader>
          {weeklyVolumeValues.some((v) => v > 0) ? (
            <VolumeTrendChart labels={weeklyVolumeLabels} values={weeklyVolumeValues} average={weeklyVolumeValues.length >= 4 ? weeklyVolumeValues.slice(-5, -1).reduce((a, b) => a + b, 0) / 4 : undefined} height={200} />
          ) : (
            <p className="py-8 text-center text-[12px] text-muted">No lifting volume recorded yet.</p>
          )}
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle>Big-3 PRs</CardTitle>
                <p className="mt-0.5 text-[12px] text-muted">Total {shortWeight(big3TotalValue)} · best e1RM per lift</p>
              </div>
              <span className="rounded-md bg-accent/12 px-1.5 py-1 text-[12px] font-medium text-accent">e1RM</span>
            </div>
          </CardHeader>
          <div className="space-y-4 px-1 pb-2">
            {big3Cards.map(({ name, pr }) => {
              const value = pr ? (pr.estimated_1rm ?? pr.weight_kg) : 0;
              return (
                <div key={name}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[12px] font-medium">{name}</span>
                    <span className="text-[12px] text-muted">{pr ? `${amount(pr.estimated_1rm ?? pr.weight_kg)} kg · ${new Date(`${pr.achieved_date}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'No record'}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-light/70">
                    {pr && <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, Math.max(2, (value / 200) * 100))}%` }} />}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <CombinedLoadHero />

      <details className="rounded-xl border border-surface-light/60 bg-surface/50">
        <summary className="flex min-h-[44px] cursor-pointer items-center justify-between px-4 text-[13px] font-medium text-muted hover:text-foreground">
          More analysis
          <span className="text-[12px] text-muted">4 reads</span>
        </summary>
        <div className="space-y-6 border-t border-surface-light/50 p-4">
      {/* Rep-range mix (overview + per-exercise) */}
      <RepRangeCard />

      {/* Volume × Intensity periodization */}
      <Card>
        <CardHeader><CardTitle>Volume × Intensity</CardTitle></CardHeader>
        <ChartBody
          isLoading={volIntLoading}
          data={volIntChart}
          emptyMessage="Log working sets to see volume and intensity trends"
          height={280}
        />
      </Card>

      {/* RPE drift (actual vs planned) */}
      <RpeDriftCard />

      {/* Strength Balance */}
      <Card>
        <CardHeader><CardTitle>Strength Balance</CardTitle></CardHeader>
        <ChartBody
          isLoading={strengthBalanceLoading}
          data={strengthBalanceChart}
          emptyMessage="Log lifts with estimated 1RM to see your strength balance"
          height={280}
        />
      </Card>

      {/* Session mix — training intent over time (Jev) */}
      <Card>
        <CardHeader><CardTitle>Session Mix</CardTitle></CardHeader>
        <ChartBody
          isLoading={sessionMixLoading}
          data={sessionMixChart}
          emptyMessage="Classified sessions appear here once the weekly Jev backfill runs"
          height={280}
        />
      </Card>

      {/* Lift frequency — competition-lift exposure over time (Jev) */}
      <Card>
        <CardHeader><CardTitle>Lift Frequency</CardTitle></CardHeader>
        <ChartBody
          isLoading={liftFrequencyLoading}
          data={liftFrequencyChart}
          emptyMessage="Classified sessions appear here once the weekly Jev backfill runs"
          height={280}
        />
      </Card>

      {/* Estimated 1RM History */}
      {e1rmExerciseList.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>Estimated 1RM History</CardTitle>
              <select
                value={effectiveE1rmExercise}
                onChange={(e) => setSelectedE1rmExercise(e.target.value)}
                className="bg-surface-light border border-surface-light text-foreground text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
                aria-label="Select exercise for 1RM history"
              >
                {e1rmExerciseList.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
          </CardHeader>
          <E1rmForecastChart
            base={e1rmHistoryChart}
            isLoading={e1rmHistoryLoading}
            exercise={effectiveE1rmExercise}
          />
        </Card>
      )}

      {/* Exercise Progress */}
      <ExerciseProgressSection sessions={sessions} />
        </div>
      </details>
        </div>
      )}

      {/* Warm-up templates (moved out of the tab bar) */}
      <Modal
        open={showTemplates}
        onClose={() => setShowTemplates(false)}
        size="xl"
        aria-label="Warm-up templates"
      >
        <ModalHeader title="Warm-up templates" onClose={() => setShowTemplates(false)} />
        <WarmupTemplateManager />
      </Modal>

      {/* Manual PR entry — modal so it is not stranded at the page bottom */}
      <Modal
        open={showManualPR}
        onClose={() => setShowManualPR(false)}
        size="lg"
        aria-label="Add personal record"
      >
        <ModalHeader title="Add personal record" onClose={() => setShowManualPR(false)} />
        <div className="p-4">
          <ManualPRForm
            onSubmit={(data) => createPRMutation.mutate(data)}
            onCancel={() => setShowManualPR(false)}
            isPending={createPRMutation.isPending}
          />
        </div>
      </Modal>

      {/* Link Activity Modal */}
      {linkModalSessionId && (
        <LinkActivityModal sessionId={linkModalSessionId} onClose={() => setLinkModalSessionId(null)} />
      )}
    </div>
  );
}

/** Estimated-1RM history + B-14 dashed forecast for the selected exercise. */
function E1rmForecastChart({
  base,
  isLoading,
  exercise,
}: {
  base: ChartData | undefined;
  isLoading: boolean;
  exercise: string;
}) {
  const { data, caption } = useForecastChart(
    base,
    'estimated_1rm',
    '1RM forecast',
    JSON.stringify({ exercise }),
  );
  return (
    <>
      <ChartBody
        isLoading={isLoading}
        data={data}
        emptyMessage="No 1RM history for this exercise yet"
        height={280}
      />
      {caption && <p className="text-[11px] text-muted mt-1">--- {caption}</p>}
    </>
  );
}
