'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthFetch, listGoals } from '@/lib/api';
import type { Goal } from '@/lib/api';
import { GoalCard } from '@/components/ui/GoalCard';
import { GoalCreateModal } from '@/components/goals/GoalCreateModal';
import { GoalDetailModal } from '@/components/goals/GoalDetailModal';

type StatusTab = 'active' | 'achieved' | 'expired' | 'all';

const TABS: { key: StatusTab; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'achieved', label: 'Achieved' },
  { key: 'expired', label: 'Expired' },
  { key: 'all', label: 'All' },
];

export default function GoalsPage() {
  const { authFetch } = useAuthFetch();
  const [tab, setTab] = useState<StatusTab>('active');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedGoal, setSelectedGoal] = useState<Goal | null>(null);

  const statusFilter = tab === 'all' ? undefined : tab;

  const {
    data: goals,
    isLoading,
    isError,
    error,
  } = useQuery<Goal[]>({
    queryKey: ['goals', tab],
    queryFn: () => listGoals(authFetch, statusFilter),
    staleTime: 60_000,
  });

  // Keep the modal's goal fresh when the list refetches after a mutation
  useEffect(() => {
    if (!selectedGoal || !goals) return;
    const fresh = goals.find((g) => g.id === selectedGoal.id);
    if (fresh && fresh !== selectedGoal) setSelectedGoal(fresh);
  }, [goals, selectedGoal]);

  const sortedGoals = useMemo(() => {
    if (!goals) return [];
    // Most-progressed first within the tab
    return [...goals].sort((a, b) => (b.progress_pct ?? 0) - (a.progress_pct ?? 0));
  }, [goals]);

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold text-white">🎯 Goals</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors"
        >
          + New Goal
        </button>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <div className="flex gap-1 bg-surface rounded-xl p-1 border border-surface-light/50 w-fit">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              tab === key
                ? 'bg-accent text-white'
                : 'text-muted hover:text-white hover:bg-surface-light/50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Grid ────────────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-36 animate-pulse bg-surface-light/40 rounded-xl" />
          ))}
        </div>
      ) : isError ? (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          ⚠️ {error instanceof Error ? error.message : 'Failed to load goals'}
        </div>
      ) : sortedGoals.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedGoals.map((goal) => (
            <GoalCard key={goal.id} goal={goal} onClick={() => setSelectedGoal(goal)} />
          ))}
        </div>
      ) : (
        <div className="text-center py-12 rounded-xl border border-surface-light/50 bg-surface-light/10">
          <p className="text-3xl mb-2">🎯</p>
          <p className="text-muted text-sm">No {tab === 'all' ? '' : tab + ' '}goals yet</p>
          <p className="text-muted text-xs mt-1">
            Set targets for FTP, 1RM, body weight, weekly sessions, and more
          </p>
        </div>
      )}

      {/* ── Modals ──────────────────────────────────────────────────────────── */}
      {showCreate && <GoalCreateModal onClose={() => setShowCreate(false)} />}
      {selectedGoal && <GoalDetailModal goal={selectedGoal} onClose={() => setSelectedGoal(null)} />}
    </div>
  );
}
