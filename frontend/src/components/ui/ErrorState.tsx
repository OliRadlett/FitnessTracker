'use client';

import React from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button } from './Button';

interface ErrorStateProps {
  title?: string;
  message?: string;
  /** Retry handler — rendered as a Retry button when provided. */
  onRetry?: () => void;
}

/**
 * Query-error card with retry. Use wherever `isError` is true —
 * never render "no data" empty states for failures.
 */
export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
}: ErrorStateProps) {
  return (
    <div
      className="bg-surface rounded-xl border border-surface-light/50 p-8 text-center"
      role="alert"
    >
      <TriangleAlert size={28} aria-hidden="true" className="text-warning mx-auto mb-3" />
      <p className="text-white font-medium mb-1">{title}</p>
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
