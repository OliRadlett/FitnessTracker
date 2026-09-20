'use client';

import React from 'react';

interface SpinnerProps {
  size?: number;
  /** Screen-reader label. */
  label?: string;
  className?: string;
}

/**
 * Single loading spinner. Prefer shape-matched `Skeleton*` primitives for
 * content areas; use `Spinner` for buttons, inline actions, and overlays.
 */
export function Spinner({ size = 20, label = 'Loading', className = '' }: SpinnerProps) {
  return (
    <span role="status" className={`inline-flex items-center justify-center ${className}`}>
      <span
        className="animate-spin rounded-full border-2 border-surface-light border-t-accent"
        style={{ width: size, height: size }}
        aria-hidden="true"
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
