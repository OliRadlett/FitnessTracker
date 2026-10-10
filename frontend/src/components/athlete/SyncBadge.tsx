'use client';

/**
 * Phase 1 (plans/ui-redesign-v2.md §1) — `SyncBadge`.
 *
 * The single home for sync staleness: stale badge + last-sync time.
 * Degradation is SHOWN, never silently averaged away. Pure presentational —
 * identical props render identically in every slot (guardrail §1.3).
 */

import React from 'react';
import { formatRelativeTime } from '@/lib/utils';

export interface SyncBadgeProps {
  /** Freshest `last_synced_at` across providers, or null when never synced. */
  lastSyncedAt?: string | null;
  /** True when any provider needs attention (stale or needs_reauth). */
  stale?: boolean;
  /** Optional provider name for context ("Whoop", "Strava"). */
  provider?: string | null;
  className?: string;
}

export function SyncBadge({ lastSyncedAt, stale, provider, className = '' }: SyncBadgeProps) {
  const label = lastSyncedAt ? formatRelativeTime(lastSyncedAt) : 'never';
  return (
    <span
      role="status"
      aria-label={
        stale
          ? `Stale data${provider ? ` from ${provider}` : ''}, last synced ${label}`
          : `Synced ${label}`
      }
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs tabular-nums ${
        stale
          ? 'border-warning/30 bg-warning/10 text-warning'
          : 'border-surface-light/60 bg-surface-light/30 text-muted'
      } ${className}`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${stale ? 'bg-warning' : 'bg-positive'}`} />
      {stale ? 'Stale' : 'Synced'}
      <span aria-hidden>·</span>
      <span>{label}</span>
    </span>
  );
}
