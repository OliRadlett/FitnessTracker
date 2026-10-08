'use client';

import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch, createLiftingSession } from '@/lib/api';
import type { AddSetPayload, CreateSessionPayload, LiftingSession } from '@/lib/api';
import { Copy } from 'lucide-react';

export interface RepeatSessionButtonProps {
  /** Source session to duplicate (sets are copied as payloads, without ids). */
  session: LiftingSession;
  /** Called with the newly created session so the browser can select/scroll to it. */
  onDuplicated?: (created: LiftingSession) => void;
  variant?: 'button' | 'icon';
  className?: string;
}

function todayISODate(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Repeat-last-session duplicate action (t4 enhancement batch).
 *
 * Reuses the `createLiftingSession + set payloads` seam: working sets (and
 * warm-ups) are re-mapped to `AddSetPayload` so the backend assigns fresh
 * ids / order. The copy is dated today and marked as a repeat in `notes`;
 * review metadata (rpe_session, linked activity, whoop) is not carried over.
 */
export function RepeatSessionButton({
  session,
  onDuplicated,
  variant = 'button',
  className = '',
}: RepeatSessionButtonProps) {
  const { authFetch, token } = useAuthFetch();
  const queryClient = useQueryClient();
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => {
      const sets: AddSetPayload[] = (session.sets ?? []).map((s, i) => ({
        exercise_name: s.exercise_name,
        set_number: s.set_number || i + 1,
        weight_kg: s.weight_kg,
        reps: s.reps,
        ...(s.rpe != null ? { rpe: s.rpe } : {}),
        ...(s.is_warmup ? { is_warmup: true } : {}),
        ...(s.is_amrap ? { is_amrap: true } : {}),
      }));
      const payload: CreateSessionPayload = {
        session_date: todayISODate(),
        ...(session.program_name ? { program_name: session.program_name } : {}),
        ...(session.focus ? { focus: session.focus } : {}),
        notes: `Repeat of ${session.session_date} session${session.notes ? ` — ${session.notes}` : ''}`,
        ...(sets.length > 0 ? { sets } : {}),
      };
      return createLiftingSession(authFetch, payload);
    },
    onSuccess: (created) => {
      setError('');
      queryClient.invalidateQueries({ queryKey: ['lifting-sessions'] });
      onDuplicated?.(created);
    },
    onError: (err: Error) => setError(err.message || 'Failed to repeat session'),
  });

  const label = session.focus ? `Repeat “${session.focus}” as today` : 'Repeat as today';

  if (variant === 'icon') {
    return (
      <span className={`inline-flex flex-col items-center ${className}`}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setError('');
            mutation.mutate();
          }}
          disabled={mutation.isPending || !token}
          title={label}
          aria-label={`${label} (${(session.sets ?? []).length} sets)`}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-muted hover:text-accent rounded transition-colors motion-reduce:transition-none disabled:opacity-50"
        >
          <Copy className="w-4 h-4" />
        </button>
        {error && (
          <span className="text-warning text-[10px] mt-0.5 max-w-[120px] text-center" role="alert">
            {error}
          </span>
        )}
      </span>
    );
  }

  return (
    <span className={`inline-flex flex-col items-start gap-1 ${className}`}>
      <button
        type="button"
        onClick={() => {
          setError('');
          mutation.mutate();
        }}
        disabled={mutation.isPending || !token}
        title={label}
        aria-label={label}
        className="min-h-[44px] inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-surface-light/50 text-muted hover:text-foreground hover:border-surface-light transition-colors motion-reduce:transition-none disabled:opacity-50"
      >
        <Copy className="w-4 h-4" aria-hidden="true" />
        {mutation.isPending ? 'Repeating…' : 'Repeat'}
      </button>
      {error && (
        <span className="text-warning text-xs" role="alert">
          {error}
        </span>
      )}
      <span className="sr-only" aria-live="polite">
        {mutation.isPending ? 'Creating a copy of this session…' : ''}
      </span>
    </span>
  );
}
