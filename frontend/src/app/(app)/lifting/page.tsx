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
  UpdateSessionPayload,
  CreatePRPayload,
  ChartData,
  LinkedActivity,
  LiftingAnalysis,
  DeficiencyResponse,
  LiftVideo,
  CyclingProfile,
} from '@/lib/api';
import {
  LEVEL_ORDER,
  levelForRatio,
  nextLevelTarget,
  ratioToBodyweight,
  standardKeyFor,
  type StandardLevel,
} from '@/lib/lifting/standards';
import { amount, previousSameFocus, shortWeight, topSet } from '@/lib/lifting/overview';
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
import { ManualPRForm } from '@/components/lifting/ManualPRForm';
import { ExerciseProgressSection } from '@/components/lifting/ExerciseProgressSection';
import { VideoChip } from '@/components/lifting/VideoChip';
import { SessionRail } from '@/components/lifting/SessionRail';
import { SetLadder } from '@/components/lifting/SetLadder';
import { useSessionBrowserFilters } from '@/components/lifting/useSessionBrowserFilters';
import { SessionLabels } from '@/components/lifting/SessionLabels';
import { RepeatSessionButton } from '@/components/lifting/RepeatSessionButton';
import { BestByRepRangeStrip } from '@/components/lifting/BestByRepRangeStrip';
import { QuickAddSetBar } from '@/components/lifting/QuickAddSetBar';
import { DotsScoreCard } from '@/components/lifting/DotsScoreCard';
import { DotsProgressionCard } from '@/components/lifting/DotsProgressionCard';
import { LiftingGoalsStrip, type GoalPrefill } from '@/components/lifting/LiftingGoalsStrip';
import { RepRangeCard } from '@/components/lifting/RepRangeCard';
import { RpeDriftCard } from '@/components/lifting/RpeDriftCard';
import { CombinedLoadChart } from '@/components/charts/CombinedLoadChart';
import { VideoGalleryModal } from '@/components/lifting/VideoGalleryModal';
import { formatDuration, getActiveLocale } from '@/lib/utils';
import { Sparkline } from '@/components/ui/Sparkline';
import { fromLocalInputValue, toLocalInputValue } from '@/lib/lifting/sessionTime';
import { useForecastChart } from '@/lib/projection';
import { usePageTitle } from '@/lib/usePageTitle';
import { LiftingAnalysisCard } from '@/components/lifting/LiftingAnalysisCard';
import { SessionAiAnalysisCard } from '@/components/lifting/SessionAiAnalysisCard';
import { PRCelebration, type PREvent } from '@/components/ui/PRCelebration';
import { DeficiencyCard } from '@/components/ui/DeficiencyCard';
import { Dumbbell, Link2, Clock, TriangleAlert, Target, Pencil, Trash2 } from 'lucide-react';

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
  const { authFetch, token } = useAuthFetch();
  const queryClient = useQueryClient();
  const { getParam, setParam } = useDeepLink();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [showNewSession, setShowNewSession] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showAddExercise, setShowAddExercise] = useState(false);
  const [showEditSession, setShowEditSession] = useState(false);
  const [confirmDeleteSession, setConfirmDeleteSession] = useState(false);
  const [showManualPR, setShowManualPR] = useState(false);
  const [showAccessories, setShowAccessories] = useState(false);
  const [selectedPRId, setSelectedPRId] = useState<string | null>(null);
  const [linkModalSessionId, setLinkModalSessionId] = useState<string | null>(null);
  const [celebrationPR, setCelebrationPR] = useState<PREvent | null>(null);
  // Lifting → goals two-way: a PR card's "Set goal" opens the strip's create
  // modal prefilled (estimated_1rm + exercise). Nulled on consume so the same
  // exercise can re-fire via a fresh nonce.
  const [goalPrefill, setGoalPrefill] = useState<GoalPrefill | null>(null);
  const handleGoalPrefillConsumed = useCallback(() => setGoalPrefill(null), []);

  // Tab URL state — syncs with `?tab=<name>` for deep-linking
  const [activeTab, setActiveTab] = useState<LiftingTab>('overview');

  // Deep-link: read tab + session/PR from URL on mount
  useEffect(() => {
    const tab = getParam('tab') as LiftingTab | 'templates' | null;
    if (tab === 'templates') {
      setShowTemplates(true);
      setActiveTab('sessions');
    } else if (tab && TAB_VALUES.includes(tab)) {
      setActiveTab(tab);
    }
    const sessionId = getParam('session');
    if (sessionId) {
      setSelectedSessionId((prev) => (prev === sessionId ? prev : sessionId));
      if (tab !== 'sessions') setActiveTab('sessions');
    }
    const prId = getParam('pr');
    if (prId) {
      setSelectedPRId(prId);
      setActiveTab('prs');
    }
  }, [getParam]);

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

  // Session browser filter state — one URL-synced (s_*) instance shared by
  // SessionFocusChips and SessionBrowser. `?session=` / `?tab=` / `?pr=` are untouched.
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
  // options and chip facets; the visible list itself is paginated by SessionBrowser.
  const { data: sessions } = useQuery<LiftingSession[]>({
    queryKey: ['lifting-sessions'],
    queryFn: () => authFetch<LiftingSession[]>('/api/v1/lifting/sessions'),
    enabled: !!token,
    staleTime: 60_000,  // 1 min
  });

  const { data: strengthBalanceChart, isLoading: strengthBalanceLoading } = useQuery<ChartData>({
    queryKey: ['chart-strength-balance', 30],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/strength_balance'),
    enabled: !!token,
    staleTime: 300_000,
  });

  const { data: big3TotalChart, isLoading: big3TotalLoading } = useQuery<ChartData>({
    queryKey: ['chart-big-3-total'],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/big_3_total'),
    enabled: !!token,
    staleTime: 300_000,
  });

  const { data: volIntChart, isLoading: volIntLoading } = useQuery<ChartData>({
    queryKey: ['chart-volume-intensity'],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/volume_intensity_periodization?weeks=26'),
    enabled: !!token,
    staleTime: 300_000,
  });

  const { data: weeklyVolumeChart, isLoading: weeklyVolumeLoading } = useQuery<ChartData>({
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

  const { data: allVideos } = useQuery<LiftVideo[]>({
    queryKey: ['lift-videos'],
    queryFn: () => authFetch<LiftVideo[]>('/api/v1/lifting/videos/?limit=200'),
    enabled: !!token,
    staleTime: 60_000,
  });

  const videoBySession = useMemo(
    () => new Map<string, LiftVideo[]>(),
    [],
  );
  const videoByPR = useMemo(
    () => new Map<string, LiftVideo[]>(),
    [],
  );
  useEffect(() => {
    if (!allVideos) return;
    const bySession = new Map<string, LiftVideo[]>();
    const byPR = new Map<string, LiftVideo[]>();
    for (const v of allVideos) {
      if (v.lifting_session_id) {
        const arr = bySession.get(v.lifting_session_id) ?? [];
        arr.push(v);
        bySession.set(v.lifting_session_id, arr);
      }
      if (v.personal_record_id) {
        const arr = byPR.get(v.personal_record_id) ?? [];
        arr.push(v);
        byPR.set(v.personal_record_id, arr);
      }
    }
    videoBySession.clear();
    for (const [k, v] of bySession) videoBySession.set(k, v);
    videoByPR.clear();
    for (const [k, v] of byPR) videoByPR.set(k, v);
  }, [allVideos, videoBySession, videoByPR]);

  const [videoGalleryOpen, setVideoGalleryOpen] = useState(false);
  const [videoGalleryVideos, setVideoGalleryVideos] = useState<LiftVideo[]>([]);
  const [videoGalleryTitle, setVideoGalleryTitle] = useState('');

  function openVideoGallery(videos: LiftVideo[], title: string) {
    setVideoGalleryVideos(videos);
    setVideoGalleryTitle(title);
    setVideoGalleryOpen(true);
  }

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
      setShowEditSession(false);
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

  // Previous same-focus session — the delta basis for the set ladder.
  const previousSession = useMemo(
    () => (sessionDetail ? previousSameFocus(sessionDetail, sessions ?? []) : null),
    [sessionDetail, sessions],
  );

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
        subtitle={sessions ? `${sessions.length} sessions · strength, tracked` : 'Strength, tracked'}
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
              className="hidden sm:inline-flex min-h-[44px] items-center px-4 py-2 bg-surface-light hover:bg-surface text-muted hover:text-foreground text-sm font-medium rounded-lg transition-colors border border-surface-light"
            >
              Start live
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

      {/* Tab bar */}
      <LiftingTabs value={activeTab} onChange={handleTabChange} />

      {/* ── Overview Tab ─────────────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <OverviewTab
          sessions={sessions ?? []}
          prs={personalRecords ?? []}
          weeklyVolumeChart={weeklyVolumeChart}
          isLoading={!sessions}
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
                    <CardTitle>{sessionDetail.focus || 'Session Detail'}</CardTitle>
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

              {/* Set ladder — read-only review layer, separate from logging/editing */}
              {sessionDetail.sets && sessionDetail.sets.length > 0 && (
                <div className="mb-4 rounded-lg border border-surface-light/50 p-3 sm:p-4">
                  <SetLadder session={sessionDetail} previous={previousSession} />
                </div>
              )}

              {/* Edit Session Form */}
              {showEditSession && (
                <div className="mb-4 p-4 bg-surface-light/30 rounded-lg space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                        onBlur={(e) => updateSessionMutation.mutate({ sessionId: selectedSessionId, data: { focus: e.target.value || undefined } })}
                        placeholder="e.g. Upper Body"
                        className="w-full bg-surface-light border border-surface-light text-foreground text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-muted mb-1">Notes</label>
                      <input
                        type="text"
                        defaultValue={sessionDetail.notes || ''}
                        onBlur={(e) => updateSessionMutation.mutate({ sessionId: selectedSessionId, data: { notes: e.target.value || undefined } })}
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
                  <button onClick={() => setShowEditSession(false)} className="px-3 py-1.5 text-muted hover:text-foreground text-sm transition-colors">Done</button>
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
        <div className="space-y-6">
          {/* Two-way goals surface: active lifting goals + PR → goal creation */}
          <LiftingGoalsStrip prefill={goalPrefill} onPrefillConsumed={handleGoalPrefillConsumed} />
          <DotsScoreCard
            personalRecords={personalRecords}
            bodyweightKg={bodyweightKg}
            isLoading={prLoading}
          />
          <DotsProgressionCard
            totalChart={big3TotalChart}
            isLoading={big3TotalLoading}
          />
          <BestByRepRangeStrip records={personalRecords} isLoading={prLoading} />

      {/* Personal Records */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Personal Records</CardTitle>
            <button
              onClick={() => setShowManualPR(!showManualPR)}
              className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors"
            >
              {showManualPR ? 'Cancel' : '+ Add PR'}
            </button>
          </div>
        </CardHeader>

        {/* Manual PR Form */}
        {showManualPR && <ManualPRForm onSubmit={(data) => createPRMutation.mutate(data)} onCancel={() => setShowManualPR(false)} isPending={createPRMutation.isPending} />}

        {prLoading ? (
          <SkeletonRow className="h-40" />
        ) : personalRecords && personalRecords.length > 0 ? (() => {
          // Group and sort PRs: Big 3 first, then compounds, then accessories
          const BIG_3 = ['Back Squat', 'Bench Press', 'Deadlift'];
          const big3PRs: PersonalRecord[] = [];
          const compoundPRs: PersonalRecord[] = [];
          const accessoryPRs: PersonalRecord[] = [];
          const big3Seen = new Set<string>();

          for (const pr of personalRecords) {
            const name = pr.exercise_name;
            if (BIG_3.includes(name) && !big3Seen.has(name)) {
              big3PRs.push(pr);
              big3Seen.add(name);
            } else if (!BIG_3.includes(name)) {
              // Heuristic: compound exercises are typically barbell/multi-joint
              const compoundHints = ['squat', 'press', 'deadlift', 'row', 'pull', 'dip', 'lunge', 'thrust', 'clean', 'snatch', 'hip'];
              const isCompound = compoundHints.some(h => name.toLowerCase().includes(h));
              if (isCompound) compoundPRs.push(pr);
              else accessoryPRs.push(pr);
            }
          }
          // Sort Big 3 in canonical order
          big3PRs.sort((a, b) => BIG_3.indexOf(a.exercise_name) - BIG_3.indexOf(b.exercise_name));
          compoundPRs.sort((a, b) => a.exercise_name.localeCompare(b.exercise_name));
          accessoryPRs.sort((a, b) => a.exercise_name.localeCompare(b.exercise_name));

           // Group PRs by exercise name for progression sparkline
           const prsByExercise = new Map<string, PersonalRecord[]>();
           for (const pr of personalRecords) {
             const arr = prsByExercise.get(pr.exercise_name) ?? [];
             arr.push(pr);
             prsByExercise.set(pr.exercise_name, arr);
           }

           const LEVEL_COLORS: Record<StandardLevel, string> = {
            beginner: 'text-muted',
            intermediate: 'text-blue-400',
            advanced: 'text-purple-400',
            elite: 'text-positive',
          };

          function PRCard({ pr, progression }: { pr: PersonalRecord; progression: (number | null)[] }) {
            const standardKey = standardKeyFor(pr.exercise_name);
            const bwRatio =
              standardKey != null
                ? ratioToBodyweight(pr.estimated_1rm, bodyweightKg)
                : null;
            const isDeepLinked = selectedPRId != null && pr.id === selectedPRId;
            return (
              <div
                className={`p-4 bg-surface-light/30 rounded-lg ${isDeepLinked ? 'ring-2 ring-accent' : ''}`}
                ref={isDeepLinked ? (el) => el?.scrollIntoView({ block: 'center' }) : undefined}
              >
                <p className="text-sm font-medium text-foreground mb-2">{pr.exercise_name}</p>
                {standardKey != null && bwRatio != null && bodyweightKg != null && (() => {
                  const level = levelForRatio(standardKey, bwRatio);
                  const next = nextLevelTarget(standardKey, level);
                  const nextName =
                    next != null ? LEVEL_ORDER[LEVEL_ORDER.indexOf(level) + 1] : null;
                  return (
                    <div className="flex items-center justify-center gap-1.5 mb-2 flex-wrap">
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-full font-medium bg-surface-light ${LEVEL_COLORS[level]}`}
                        title={`Estimated 1RM is ${bwRatio.toFixed(2)}× bodyweight (${bodyweightKg.toFixed(0)} kg)`}
                      >
                        {level.charAt(0).toUpperCase() + level.slice(1)} · {bwRatio.toFixed(2)}× BW
                      </span>
                      {next != null && nextName != null && (
                        <span className="text-[11px] text-muted">
                          → {Math.round(next * bodyweightKg)} kg {nextName}
                        </span>
                      )}
                    </div>
                  );
                })()}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-center">
                   <div>
                     <p className="text-lg font-bold text-blue-400">{pr.weight_kg} kg</p>
                     <p className="text-xs text-muted">Weight</p>
                   </div>
                   <div>
                     <p className="text-lg font-bold text-positive">{pr.reps}</p>
                     <p className="text-xs text-muted">Reps</p>
                   </div>
                   <div>
                     <p className="text-lg font-bold text-purple-400">{pr.estimated_1rm?.toFixed(1)} kg</p>
                     <p className="text-xs text-muted">Est. 1RM</p>
                   </div>
                 </div>
                 {progression.length > 1 && (
                   <div className="mt-2 h-4">
                     <Sparkline
                       data={progression}
                       height={16}
                       color={pr.estimated_1rm != null ? "rgb(168 85 247)" : "rgb(96 165 250)"}
                     />
                   </div>
                 )}
                <p className="text-xs text-muted mt-2 text-center">
                  {new Date(pr.achieved_date).toLocaleDateString(getActiveLocale())}
                </p>
                 {pr.notes && <p className="text-xs text-accent mt-1 text-center">{pr.notes}</p>}
                 {(() => {
                   const pv = videoByPR.get(pr.id);
                   if (!pv || pv.length === 0) return null;
                   return (
                     <button
                       onClick={(e) => {
                         e.stopPropagation();
                         openVideoGallery(pv, `${pr.exercise_name} PR videos`);
                       }}
                       title={`${pv.length} video${pv.length !== 1 ? 's' : ''}`}
                       className="mt-2 mx-auto flex items-center justify-center gap-1"
                     >
                       <VideoChip count={pv.length} />
                     </button>
                   );
                 })()}
                 {pr.activity_id && (
                  <Link
                    href={`/activities?activity=${pr.activity_id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="mt-2 text-xs text-accent/70 hover:text-accent text-center block transition-colors"
                  >
                    View activity →
                  </Link>
                )}
                {pr.session_id && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSelectSession(pr.session_id as string);
                      handleTabChange('sessions');
                    }}
                    className="mt-1 text-xs text-accent/70 hover:text-accent text-center block w-full transition-colors"
                  >
                    View session →
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setGoalPrefill({
                      metric: 'estimated_1rm',
                      exercise: pr.exercise_name,
                      nonce: Date.now(),
                    });
                  }}
                  className="mt-1 min-h-[44px] px-3 text-xs text-accent/70 hover:text-accent text-center block w-full transition-colors"
                  title={`Set a 1RM goal for ${pr.exercise_name}`}
                >
                   <Target className="w-3 h-3 mr-1" /> Set goal
                </button>
              </div>
            );
          }

          // Calculate Big 3 total
          const big3Total = big3PRs.reduce((sum, pr) => sum + (pr.estimated_1rm || pr.weight_kg), 0);

          return (
            <div className="space-y-4">
              {/* Big 3 */}
              {big3PRs.length > 0 && (
                <div>
                  <div className="flex items-center gap-4 mb-3">
                    <h3 className="text-xs font-semibold text-blue-400 uppercase tracking-wider">Big 3</h3>
                    {big3Total > 0 && (
                      <span className="text-xs font-bold text-foreground bg-blue-500/20 px-3 py-1 rounded-full">
                        Total: {Math.round(big3Total)} kg
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {big3PRs.map((pr) => (
                      <PRCard
                        key={pr.id}
                        pr={pr}
                        progression={(prsByExercise.get(pr.exercise_name) ?? []).map((p) => p.estimated_1rm ?? p.weight_kg ?? null)}
                      />
                    ))}
                  </div>
                </div>
              )}
              {/* Other Compounds */}
              {compoundPRs.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-positive uppercase tracking-wider mb-3">Compounds</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {compoundPRs.map((pr) => (
                      <PRCard
                        key={pr.id}
                        pr={pr}
                        progression={(prsByExercise.get(pr.exercise_name) ?? []).map((p) => p.estimated_1rm ?? p.weight_kg ?? null)}
                      />
                    ))}
                  </div>
                </div>
              )}
              {/* Accessories (behind toggle) */}
              {accessoryPRs.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowAccessories(!showAccessories)}
                    className="text-xs font-semibold text-muted hover:text-foreground uppercase tracking-wider mb-3 transition-colors flex items-center gap-1"
                  >
                    <span>{showAccessories ? '▾' : '▸'}</span> Accessories ({accessoryPRs.length})
                  </button>
                  {showAccessories && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {accessoryPRs.map((pr) => (
                        <PRCard
                          key={pr.id}
                          pr={pr}
                          progression={(prsByExercise.get(pr.exercise_name) ?? []).map((p) => p.estimated_1rm ?? p.weight_kg ?? null)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })() : (
          <p className="text-muted text-center py-8">No personal records yet</p>
        )}
      </Card>

      {/* Weakness / Deficiency Analysis */}
      <DeficiencyCard data={deficiency} isLoading={deficiencyLoading} category="lifting" />
        </div>
      )}

      {/* ── Analytics Tab ──────────────────────────────────────────────────────── */}
      {activeTab === 'analytics' && (
        <div className="space-y-6">

      {/* Featured: unified cycling + lifting load */}
      <CombinedLoadChart />

      {/* Big-3 Total progression */}
      <Card>
        <CardHeader><CardTitle>Big-3 Total</CardTitle></CardHeader>
        <ChartBody
          isLoading={big3TotalLoading}
          data={big3TotalChart}
          emptyMessage="Log 1RM PRs on squat, bench, and deadlift to track your total"
          height={280}
        />
      </Card>

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

      {/* Weekly Volume — backend attaches an injury-risk insight on spikes */}
      <Card>
        <CardHeader><CardTitle>Weekly Volume</CardTitle></CardHeader>
        <ChartBody
          isLoading={weeklyVolumeLoading}
          data={weeklyVolumeChart}
          emptyMessage="No lifting volume recorded yet"
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

      {/* Link Activity Modal */}
      {linkModalSessionId && (
        <LinkActivityModal sessionId={linkModalSessionId} onClose={() => setLinkModalSessionId(null)} />
      )}

      {/* Strength Video Gallery Modal (§1.1) */}
      <VideoGalleryModal
        title={videoGalleryTitle}
        videos={videoGalleryVideos}
        open={videoGalleryOpen}
        onClose={() => setVideoGalleryOpen(false)}
      />
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
