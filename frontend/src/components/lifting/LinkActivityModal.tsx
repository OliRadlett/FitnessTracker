'use client';

import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type { Activity, LiftingSession } from '@/lib/api';

function formatDuration(seconds?: number | null): string {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function LinkActivityModal({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const { authFetch } = useAuthFetch();
  const queryClient = useQueryClient();

  const { data: linkableActivities, isLoading } = useQuery<Activity[]>({
    queryKey: ['linkable-activities', sessionId],
    queryFn: () => authFetch<Activity[]>(`/api/v1/lifting/sessions/${sessionId}/linkable-activities`),
  });

  const linkMutation = useMutation({
    mutationFn: (activityId: string) =>
      authFetch<LiftingSession>(`/api/v1/lifting/sessions/${sessionId}/link`, {
        method: 'PUT',
        body: JSON.stringify({ activity_id: activityId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lifting-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['lifting-session', sessionId] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-xl border border-surface-light p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Link Strava Activity</h3>
          <button onClick={onClose} className="text-muted hover:text-white text-xl">×</button>
        </div>
        {isLoading ? (
          <div className="animate-pulse space-y-3">
            {[1, 2, 3].map((i) => (<div key={i} className="h-16 bg-surface-light rounded-lg"></div>))}
          </div>
        ) : linkableActivities && linkableActivities.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm text-muted mb-3">Select a Strava strength activity to link:</p>
            {linkableActivities.map((activity) => (
              <button
                key={activity.id}
                onClick={() => linkMutation.mutate(activity.id)}
                disabled={linkMutation.isPending}
                className="w-full text-left p-3 bg-surface-light/40 hover:bg-surface-light/60 rounded-lg border border-surface-light/50 hover:border-accent/30 transition-all disabled:opacity-50"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-white">{activity.name}</p>
                    <p className="text-xs text-muted">
                      {new Date(activity.start_date).toLocaleString()} · {activity.sport_type}
                    </p>
                  </div>
                  <div className="text-right text-xs text-muted">
                    {activity.duration_seconds && <p>{formatDuration(activity.duration_seconds)}</p>}
                    {activity.average_heartrate && <p>HR: {Math.round(activity.average_heartrate)}</p>}
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-muted text-center py-8">No unlinked Strava strength activities found for this date range.</p>
        )}
        {linkMutation.isError && <p className="text-warning text-sm mt-3">Failed to link activity</p>}
      </div>
    </div>
  );
}
