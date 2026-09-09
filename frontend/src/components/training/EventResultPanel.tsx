'use client';

import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type { Event, EventResult } from '@/lib/api';

// Formats like "3:24:10" / "3h 24m". Returns the raw string if unparseable.
function formatFinishingTime(secondsOrStr: string | number | undefined | null): string {
  if (secondsOrStr == null) return '';
  if (typeof secondsOrStr === 'number') {
    const h = Math.floor(secondsOrStr / 3600);
    const m = Math.floor((secondsOrStr % 3600) / 60);
    const s = Math.round(secondsOrStr % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
  }
  return String(secondsOrStr);
}

function ResultBadge({ result }: { result: EventResult }) {
  const bits = [];
  if (result.finishing_position != null) bits.push(`#${result.finishing_position} overall`);
  if (result.class_position != null) bits.push(`#${result.class_position} class`);
  if (result.finishing_time) bits.push(formatFinishingTime(result.finishing_time));
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {result.personal_best && (
        <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/15 text-amber-400 font-medium">
          🏅 PB
        </span>
      )}
      {bits.map((b) => (
        <span key={b} className="px-1.5 py-0.5 rounded text-[10px] bg-surface-light/60 text-white/80 font-medium">
          {b}
        </span>
      ))}
      {result.notes && (
        <span className="text-[11px] text-muted italic">"{result.notes}"</span>
      )}
    </div>
  );
}

export function EventResultPanel({ event }: { event: Event }) {
  const { authFetch } = useAuthFetch();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  // Only allow logging a result for past events without one.
  const isPast = (event.event_date ?? '') <= new Date().toISOString().slice(0, 10);
  const hasResult = !!event.result && Object.keys(event.result).some(
    (k) => event.result?.[k as keyof EventResult] != null,
  );

  const [form, setForm] = useState<EventResult>({});
  const [actionError, setActionError] = useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['events'] });
    queryClient.invalidateQueries({ queryKey: ['events', 'upcoming'] });
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };

  const saveMutation = useMutation({
    mutationFn: (payload: EventResult) =>
      authFetch<Event>(`/api/v1/events/${event.id}/result`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      setShowForm(false);
      setForm({});
      setActionError(null);
      invalidate();
    },
    onError: (err: Error) =>
      setActionError(err.message || 'Failed to save result'),
  });

  const clearMutation = useMutation({
    mutationFn: () =>
      authFetch<Event>(`/api/v1/events/${event.id}/result`, { method: 'DELETE' }),
    onSuccess: invalidate,
    onError: (err: Error) =>
      setActionError(err.message || 'Failed to clear result'),
  });

  if (!isPast && !hasResult) return null;

  return (
    <>
      {(isPast || hasResult) && (
        <div className="mt-1.5 rounded-lg border border-surface-light/40 bg-surface-light/20 p-2">
          {hasResult ? (
            <div>
              <ResultBadge result={event.result!} />
              <div className="mt-1.5 flex items-center gap-2">
                <button
                  onClick={() => {
                    setForm(event.result ?? {});
                    setShowForm((s) => !s);
                  }}
                  className="text-[11px] text-accent hover:text-accent/80"
                >
                  {showForm ? 'Cancel' : 'Edit result'}
                </button>
                <button
                  onClick={() => clearMutation.mutate()}
                  disabled={clearMutation.isPending}
                  className="text-[11px] text-warning hover:text-warning/80 disabled:opacity-50"
                >
                  Clear
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowForm((s) => !s)}
              className="min-h-[44px] flex items-center text-xs text-accent hover:text-accent/80 font-medium"
            >
              🏁 Log result
            </button>
          )}

          {showForm && (
            <div className="mt-2 space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-muted mb-0.5">
                    Finish time (or seconds)
                  </label>
                  <input
                    type="text"
                    value={form.finishing_time ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, finishing_time: e.target.value || null }))}
                    placeholder="3:24:10"
                    className="w-full bg-surface-light border border-surface-light text-white text-sm rounded px-2 py-1.5 min-h-[44px] focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-muted mb-0.5">Overall position</label>
                  <input
                    type="number"
                    min={1}
                    value={form.finishing_position ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        finishing_position: e.target.value ? Number(e.target.value) : null,
                      }))
                    }
                    placeholder="e.g. 12"
                    className="w-full bg-surface-light border border-surface-light text-white text-sm rounded px-2 py-1.5 min-h-[44px] focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-muted mb-0.5">Class position</label>
                  <input
                    type="number"
                    min={1}
                    value={form.class_position ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        class_position: e.target.value ? Number(e.target.value) : null,
                      }))
                    }
                    placeholder="e.g. 3"
                    className="w-full bg-surface-light border border-surface-light text-white text-sm rounded px-2 py-1.5 min-h-[44px] focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
                <div className="flex items-end gap-2 pb-0.5">
                  <label className="flex items-center gap-1.5 text-[11px] text-white">
                    <input
                      type="checkbox"
                      checked={!!form.personal_best}
                      onChange={(e) => setForm((f) => ({ ...f, personal_best: e.target.checked }))}
                      className="accent-accent"
                    />
                    PB achieved
                  </label>
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-muted mb-0.5">Notes</label>
                <input
                  type="text"
                  value={form.notes ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value || null }))}
                  placeholder="How did it go?"
                  maxLength={500}
                  className="w-full bg-surface-light border border-surface-light text-white text-sm rounded px-2 py-1.5 min-h-[44px] focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
              {actionError && (
                <p className="text-[11px] text-warning" role="alert">{actionError}</p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => saveMutation.mutate(form)}
                  disabled={saveMutation.isPending}
                  className="px-3 py-1.5 min-h-[44px] text-xs bg-accent/20 text-accent border border-accent/30 rounded-lg hover:bg-accent/30 transition-colors disabled:opacity-50 font-medium"
                >
                  {saveMutation.isPending ? 'Saving…' : 'Save result'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}