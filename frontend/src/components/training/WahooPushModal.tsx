'use client';

/**
 * WahooPushModal — push a planned cycle day to a Wahoo computer.
 *
 * The user chooses the structured workout and/or the assigned route. A single
 * Wahoo workout instance carries both, so the ELEMNT shows the targets and the
 * navigation together. Manual, per-day only.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TrainingWeekDay } from '@/lib/api';
import { useAuthFetch, pushPlanDayToWahoo, removePlanDayFromWahoo } from '@/lib/api';
import { Modal, ModalHeader } from '@/components/ui/Modal';

interface WahooPushModalProps {
  open: boolean;
  onClose: () => void;
  planId: string;
  day: TrainingWeekDay | null;
}

/** Wahoo only displays a workout scheduled today through +6 days. */
function isWithinDisplayWindow(dayDate: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dayDate.slice(0, 10) + 'T00:00:00');
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  return diff >= 0 && diff <= 6;
}

export function WahooPushModal({ open, onClose, planId, day }: WahooPushModalProps) {
  const { authFetch } = useAuthFetch();
  const queryClient = useQueryClient();

  const alreadyPushed = !!day?.wahoo_pushed_at;
  const [pushWorkout, setPushWorkout] = useState(true);
  const [pushRoute, setPushRoute] = useState(true);

  const canPushRoute = !!day?.planned_route_id;
  const hasWorkoutTarget =
    day?.planned_power_watts != null || !!day?.planned_zone;

  // Seed checkboxes whenever the modal opens for a new day.
  useEffect(() => {
    if (!open || !day) return;
    setPushWorkout(day.wahoo_push_workout ?? true);
    setPushRoute(day.wahoo_push_route ?? canPushRoute);
  }, [open, day, canPushRoute]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['plan-week', planId] });
  };

  const pushMutation = useMutation({
    mutationFn: () =>
      pushPlanDayToWahoo(authFetch, planId, day!.id, {
        push_workout: pushWorkout,
        push_route: pushRoute,
      }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => removePlanDayFromWahoo(authFetch, planId, day!.id),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  const error = (pushMutation.error ?? removeMutation.error) as Error | null;
  const busy = pushMutation.isPending || removeMutation.isPending;
  const nothingSelected = !pushWorkout && !pushRoute;

  const inWindow = useMemo(
    () => (day ? isWithinDisplayWindow(day.day_date) : true),
    [day]
  );

  if (!day) return null;

  return (
    <Modal open={open} onClose={onClose} size="lg" aria-label="Push to Wahoo">
      <ModalHeader title="Push to Wahoo" onClose={onClose} icon="📤" />

      <p className="text-xs text-muted mb-4">
        {day.day_date.slice(0, 10)} · {day.sport === 'cycle' ? 'Cycle' : day.sport}
        {day.planned_duration_min ? ` · ${day.planned_duration_min} min` : ''}
      </p>

      {!inWindow && (
        <div className="mb-4 rounded-lg bg-warning/10 border border-warning/30 px-3 py-2 text-[11px] text-warning">
          This day is outside Wahoo&apos;s on-device window (today to 6 days out).
          It will be scheduled now but only appear on your ELEMNT once in range.
        </div>
      )}

      <div className="space-y-3 mb-4">
        {/* Structured workout */}
        <label className="flex items-start gap-3 p-3 rounded-lg bg-surface-light/20 border border-surface-light/50 cursor-pointer">
          <input
            type="checkbox"
            checked={pushWorkout}
            onChange={(e) => setPushWorkout(e.target.checked)}
            className="mt-0.5 accent-accent"
          />
          <span className="min-w-0">
            <span className="block text-sm text-foreground font-medium">
              Structured workout
            </span>
            <span className="block text-[11px] text-muted">
              {hasWorkoutTarget
                ? `Power/zone targets from your planned ${
                    day.planned_zone ? day.planned_zone.toUpperCase() : 'power'
                  }`
                : 'Uses your endurance zone (Z2) — no power/zone set. Requires FTP.'}
            </span>
          </span>
        </label>

        {/* Route */}
        <label
          className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${
            canPushRoute
              ? 'bg-surface-light/20 border-surface-light/50'
              : 'bg-surface-light/10 border-surface-light/30 opacity-60 cursor-not-allowed'
          }`}
        >
          <input
            type="checkbox"
            checked={pushRoute && canPushRoute}
            disabled={!canPushRoute}
            onChange={(e) => setPushRoute(e.target.checked)}
            className="mt-0.5 accent-accent"
          />
          <span className="min-w-0">
            <span className="block text-sm text-foreground font-medium">Route</span>
            <span className="block text-[11px] text-muted">
              {canPushRoute
                ? 'Upload the assigned route as a FIT course'
                : 'Assign a route to this day first'}
            </span>
          </span>
        </label>
      </div>

      {error && (
        <div className="mb-3 rounded-lg bg-warning/10 border border-warning/30 px-3 py-2 text-[11px] text-warning whitespace-pre-wrap">
          {error.message}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={() => pushMutation.mutate()}
          disabled={busy || nothingSelected}
          className="flex-1 min-h-[44px] px-3 py-2 bg-accent/20 text-accent rounded-lg text-sm font-medium hover:bg-accent/30 disabled:opacity-40"
        >
          {busy && pushMutation.isPending
            ? 'Pushing…'
            : alreadyPushed
              ? 'Re-push to Wahoo'
              : 'Push to Wahoo'}
        </button>
        {alreadyPushed && (
          <button
            onClick={() => removeMutation.mutate()}
            disabled={busy}
            className="min-h-[44px] px-3 py-2 text-warning hover:bg-warning/10 rounded-lg text-sm font-medium disabled:opacity-40"
          >
            {removeMutation.isPending ? 'Removing…' : 'Remove'}
          </button>
        )}
      </div>
      {nothingSelected && (
        <p className="mt-2 text-[11px] text-muted">
          Select the workout and/or route to push.
        </p>
      )}
    </Modal>
  );
}
