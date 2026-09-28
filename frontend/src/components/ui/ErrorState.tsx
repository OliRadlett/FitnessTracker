'use client';

import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { Button } from './Button';

interface ErrorStateProps {
  title?: string;
  message?: string;
  /** Retry handler. Defaults to invalidating all queries (inline variant). */
  onRetry?: () => void;
  /** "card" (default) — full card; "inline" — thin top-of-page banner. */
  variant?: 'card' | 'inline';
  /** When false, render nothing — convenience for `show={isError}`. */
  show?: boolean;
}

/**
 * Query-error surface with retry. Use wherever `isError` is true —
 * never render "no data" empty states for failures.
 *
 * - `variant="card"` (default): full card, for empty regions / section errors.
 * - `variant="inline"`: thin banner for the top of a page whose core query failed.
 */
export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  variant = 'card',
  show = true,
}: ErrorStateProps) {
  const queryClient = useQueryClient();
  if (!show) return null;
  const retry = onRetry ?? (() => queryClient.invalidateQueries());

  if (variant === 'inline') {
    return (
      <div
        className="flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-warning text-sm"
        role="alert"
      >
        <span>{message ?? title}</span>
        <button
          type="button"
          onClick={retry}
          className="shrink-0 font-medium underline hover:no-underline"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div
      className="bg-surface rounded-xl border border-surface-light/50 p-8 text-center"
      role="alert"
    >
      <TriangleAlert size={28} aria-hidden="true" className="text-warning mx-auto mb-3" />
      <p className="text-foreground font-medium mb-1">{title}</p>
      {message ? <p className="text-muted text-sm max-w-md mx-auto">{message}</p> : null}
      {onRetry ? (
        <div className="mt-4">
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : null}
    </div>
  );
}
