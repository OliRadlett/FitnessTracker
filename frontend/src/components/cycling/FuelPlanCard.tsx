'use client';

import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type { Activity, RideFuelPlan } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { SkeletonRow } from '@/components/ui/Skeleton';
import { relativeTime } from '@/lib/analysisRenderer';

interface FuelPlanCardProps {
  activity?: Activity;
}

function StatBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-light/30 rounded-lg px-4 py-3 text-center">
      <p className="text-xs text-muted uppercase tracking-wide">{label}</p>
      <p className="text-lg font-semibold text-white mt-1">{value}</p>
    </div>
  );
}

function ActualsEditor({ plan, activityId }: { plan: RideFuelPlan; activityId?: string }) {
  const { authFetch } = useAuthFetch();
  const queryClient = useQueryClient();

  const [waterMl, setWaterMl] = useState(plan.actual_water_ml?.toString() ?? '');
  const [carbsG, setCarbsG] = useState(plan.actual_carbs_g?.toString() ?? '');
  const [electrolytesMg, setElectrolytesMg] = useState(plan.actual_electrolytes_mg?.toString() ?? '');

  useEffect(() => {
    setWaterMl(plan.actual_water_ml?.toString() ?? '');
    setCarbsG(plan.actual_carbs_g?.toString() ?? '');
    setElectrolytesMg(plan.actual_electrolytes_mg?.toString() ?? '');
  }, [plan]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = JSON.stringify({
        actual_water_ml: waterMl !== '' ? parseFloat(waterMl) : null,
        actual_carbs_g: carbsG !== '' ? parseFloat(carbsG) : null,
        actual_electrolytes_mg: electrolytesMg !== '' ? parseFloat(electrolytesMg) : null,
      });
      if (plan.id) {
        return authFetch<RideFuelPlan>(`/api/v1/nutrition/fuel-plan/${plan.id}`, {
          method: 'PATCH',
          body,
        });
      }
      // No plan yet — create minimal plan with actuals
      return authFetch<RideFuelPlan>(
        `/api/v1/nutrition/fuel-plan/actuals?activity_id=${activityId}`,
        { method: 'POST', body }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fuel-plan'] });
    },
  });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-muted mb-1">Water (ml)</label>
          <input
            type="number"
            min={0}
            value={waterMl}
            onChange={(e) => setWaterMl(e.target.value)}
            placeholder="0"
            className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">Carbs (g)</label>
          <input
            type="number"
            min={0}
            value={carbsG}
            onChange={(e) => setCarbsG(e.target.value)}
            placeholder="0"
            className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">Electrolytes (mg)</label>
          <input
            type="number"
            min={0}
            value={electrolytesMg}
            onChange={(e) => setElectrolytesMg(e.target.value)}
            placeholder="0"
            className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="px-4 py-2 text-sm font-medium bg-accent/20 hover:bg-accent/30 text-accent border border-accent/30 rounded-lg transition-colors disabled:opacity-50"
        >
          {saveMutation.isPending ? 'Saving…' : 'Save Actuals'}
        </button>
        {saveMutation.isError && (
          <span className="text-xs text-warning">Save failed — try again</span>
        )}
        {saveMutation.isSuccess && !saveMutation.isPending && (
          <span className="text-xs text-positive">Saved</span>
        )}
      </div>
    </div>
  );
}

export function FuelPlanCard({ activity }: FuelPlanCardProps) {
  const { authFetch } = useAuthFetch();
  const queryClient = useQueryClient();

  const enabled = !!activity?.id;

  const { data: plan, isLoading, isError, error } = useQuery<RideFuelPlan | null>({
    queryKey: ['fuel-plan', activity?.id ?? 'none'],
    queryFn: () => authFetch<RideFuelPlan | null>(`/api/v1/nutrition/fuel-plan/activity/${activity!.id}`),
    enabled,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      authFetch<RideFuelPlan>('/api/v1/nutrition/fuel-plan', {
        method: 'POST',
        body: JSON.stringify({ activity_id: activity!.id }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fuel-plan', activity?.id] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      authFetch<void>(`/api/v1/nutrition/fuel-plan/${plan!.id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fuel-plan', activity?.id] });
    },
  });

  if (!enabled) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Ride Fuel Plan</CardTitle>
          {plan && (
            <div className="flex gap-2">
              <button
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending}
                className="text-xs text-accent hover:text-accent/80 disabled:opacity-50"
              >
                Regenerate
              </button>
              <button
                onClick={() => {
                  if (confirm('Delete this fuel plan?')) deleteMutation.mutate();
                }}
                disabled={deleteMutation.isPending}
                className="text-xs text-warning hover:text-red-300 disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </CardHeader>

      {isLoading && <SkeletonRow />}

      {isError && (
        <div className="space-y-2">
          <p className="text-sm text-warning">Could not load fuel plan.</p>
          <p className="text-xs text-muted">{(error as Error)?.message || 'Unknown error'}</p>
          <button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
            className="px-4 py-2 text-sm font-medium bg-accent/20 hover:bg-accent/30 text-accent border border-accent/30 rounded-lg transition-colors disabled:opacity-50"
          >
            {createMutation.isPending ? 'Generating…' : 'Generate Fuel Plan'}
          </button>
        </div>
      )}

      {!isLoading && !isError && !plan && (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Generate a fuel plan, or log what you actually consumed below.
          </p>
          <button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
            className="px-4 py-2 text-sm font-medium bg-accent/20 hover:bg-accent/30 text-accent border border-accent/30 rounded-lg transition-colors disabled:opacity-50"
          >
            {createMutation.isPending ? 'Generating…' : 'Generate Fuel Plan'}
          </button>
          {createMutation.isError && (
            <p className="text-xs text-warning">Failed to generate fuel plan — try again.</p>
          )}
          <ActualsEditor
            plan={plan ?? { actual_water_ml: null, actual_carbs_g: null, actual_electrolytes_mg: null, id: '' } as RideFuelPlan}
            activityId={activity?.id}
          />
        </div>
      )}

      {!isLoading && !isError && plan && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
            <StatBadge label="Pre carbs" value={`${plan.pre_ride_carbs_g} g`} />
            <StatBadge label="Carbs/hr" value={`${plan.during_carbs_per_hour_g} g`} />
            <StatBadge label="Hydration" value={`${plan.during_hydration_ml_per_hour} ml/h`} />
            <StatBadge label="Sodium" value={`${plan.during_sodium_mg_per_hour} mg/h`} />
            <StatBadge label="Recovery" value={`${plan.post_ride_carbs_g}g C / ${plan.post_ride_protein_g}g P`} />
          </div>

          {plan.schedule && plan.schedule.length > 0 && (
            <div className="mb-6">
              <h4 className="text-sm font-medium text-muted mb-3">Fuelling Timeline</h4>
              <div className="space-y-3">
                {plan.schedule.map((entry) => (
                  <div key={entry.time_min} className="flex items-start gap-3">
                    <span className="inline-flex shrink-0 items-center justify-center min-w-[64px] px-2 py-1 text-xs font-semibold bg-accent/20 text-accent border border-accent/30 rounded-full">
                      {entry.time_min} min
                    </span>
                    <div className="min-w-0">
                      {entry.suggestion && (
                        <p className="text-sm text-slate-200">{entry.suggestion}</p>
                      )}
                      <p className="text-xs text-muted">
                        {entry.carbs_g}g carbs · {entry.hydration_ml}ml · {entry.sodium_mg}mg sodium
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mb-4">
            <ActualsEditor key={plan.id} plan={plan} />
          </div>

          <p className="text-xs text-muted">
            Generated {relativeTime(plan.created_at)}
          </p>
        </>
      )}
    </Card>
  );
}
