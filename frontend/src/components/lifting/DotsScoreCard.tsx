'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import type { PersonalRecord } from '@/lib/api';
import { dots } from '@/lib/lifting/standards';
import { Award } from 'lucide-react';

const BIG_3 = ['Back Squat', 'Bench Press', 'Deadlift'];

/**
 * Current Dots score from the best Big-3 estimated 1RMs + bodyweight.
 * Male formula only (the schema has no sex field) — stated on the card.
 * Renders nothing while PRs load; shows a bodyweight hint when BW is unknown.
 */
export function DotsScoreCard({
  personalRecords,
  bodyweightKg,
  isLoading,
}: {
  personalRecords?: PersonalRecord[];
  bodyweightKg: number | null;
  isLoading?: boolean;
}) {
  const total = useMemo(() => {
    if (!personalRecords) return null;
    const best = new Map<string, number>();
    for (const pr of personalRecords) {
      if (!BIG_3.includes(pr.exercise_name)) continue;
      const e1rm = pr.estimated_1rm ?? pr.weight_kg;
      if (e1rm > (best.get(pr.exercise_name) ?? 0)) best.set(pr.exercise_name, e1rm);
    }
    if (best.size === 0) return null;
    return [...best.values()].reduce((a, b) => a + b, 0);
  }, [personalRecords]);

  if (isLoading || personalRecords === undefined) return null;

  const score = total != null ? dots(total, bodyweightKg, 'male') : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="inline-flex items-center gap-1.5">
            <Award className="w-4 h-4" aria-hidden />
            Dots Score
          </span>
        </CardTitle>
      </CardHeader>
      {score != null && total != null && bodyweightKg != null ? (
        <div className="flex items-baseline gap-3 flex-wrap">
          <p className="text-3xl font-bold text-foreground tabular-nums">
            {score.toFixed(1)}
          </p>
          <p className="text-xs text-muted">
            {Math.round(total)} kg total @ {bodyweightKg.toFixed(0)} kg BW · Male formula
          </p>
        </div>
      ) : total == null ? (
        <p className="text-sm text-muted">
          Log 1RM PRs on squat, bench, and deadlift to see your Dots score.
        </p>
      ) : (
        <p className="text-sm text-muted">
          Add your bodyweight{' '}
          <Link href="/settings" className="text-accent hover:text-accent-hover">
            in Settings
          </Link>{' '}
          to see your Dots score.
        </p>
      )}
    </Card>
  );
}
