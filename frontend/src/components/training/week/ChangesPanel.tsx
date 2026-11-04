'use client';

import React from 'react';
import Link from 'next/link';
import { HeartPulse } from 'lucide-react';

import type { AdaptiveSuggestionsResponse, PlanReviewResponse } from '@/lib/api';
import { planVerdict } from '@/lib/training/coverage';

/**
 * "What should change" — one verdict, one prerequisite, one footnote.
 *
 * The old Review mode composed the persisted weekly-review snapshot *and* the live
 * suggestion engine on one screen, so it said both "health signals are flagging,
 * resolve before adding load" and "signals are balanced — stick to the plan". The
 * reconciliation lives in `planVerdict`, not here: this component only renders it.
 */
export function ChangesPanel({
  suggestions,
  review,
}: {
  suggestions?: AdaptiveSuggestionsResponse;
  review?: PlanReviewResponse;
}) {
  if (!suggestions && !review) return null;

  const v = planVerdict(suggestions, review);
  const checked = (suggestions?.axes.length ?? 0) + (review?.adaptive?.axes.length ?? 0);

  return (
    <section className="mt-4" aria-labelledby="changes-heading">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="changes-heading" className="text-base font-semibold text-foreground">
          What should change
        </h2>
        {checked > 0 && (
          <span className="text-xs text-muted">
            {checked} signals checked
            {suggestions?.generated_at
              ? ` · newest ${new Date(suggestions.generated_at).getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][new Date(suggestions.generated_at).getMonth()]}`
              : ''}
          </span>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-white/[0.07] bg-surface">
        <div className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-start sm:gap-3">
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold sm:mt-0.5 ${
              v.tone === 'caution'
                ? 'border-caution/30 bg-caution/10 text-caution'
                : v.tone === 'pending'
                  ? 'border-surface-light bg-surface-light/20 text-muted'
                  : 'border-positive/30 bg-positive/10 text-positive'
            }`}
          >
            1
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">{v.headline}</p>
            <p className="mt-0.5 text-sm text-muted">{v.reason}</p>
            <p className="mt-1 text-xs text-muted">source: {v.source}</p>
          </div>
          {v.action && (
            // Below the reason on a phone: beside it at 390 the guidance was squeezed
            // into six short lines.
            <Link
              href={v.action.href}
              className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 self-start rounded-lg border border-white/10 px-3 text-sm font-medium text-foreground hover:bg-white/[0.05]"
            >
              <HeartPulse className="h-4 w-4" />
              {v.action.label}
            </Link>
          )}
        </div>

        <div className="flex items-start gap-3 border-t border-white/[0.05] px-3 py-3">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-xs font-semibold text-muted">
            2
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-foreground">
              {v.action ? 'Nothing else needs to change this week.' : 'Nothing needs to change this week.'}
            </p>
            <p className="mt-0.5 text-sm text-muted">
              {v.action
                ? 'The load is in the healthy band, and the week as written is still the right week.'
                : 'The week as written is still the right week.'}
            </p>
          </div>
        </div>

        {v.conflict && (
          <p className="border-t border-white/[0.05] bg-white/[0.02] px-3 py-2 text-xs text-muted">
            The {v.conflict.snapshotDate} review rated load{' '}
            <span className="text-foreground">{v.conflict.snapshot}</span>; the {v.conflict.liveDate} engine
            rates it <span className="text-foreground">{v.conflict.live}</span>. The newer read is used, and
            the older one is not shown as a second verdict.
          </p>
        )}
      </div>
    </section>
  );
}
