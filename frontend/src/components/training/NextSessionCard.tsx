'use client';

// Feature 6 / B-17 — next-session suggestion card.
//
// The self-fetching `NextSessionCardAuto` variant was removed with the cycling
// page rewrite: it was mounted only there, and it contradicted the page's own
// numbers (it suggested "no maximal efforts" while the load data said the athlete
// was detraining). `/today` renders the presentational `NextSessionCard` from
// inputs it already holds.

import React from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { computeVerdict } from '@/lib/brief';
import { nextSessionSuggestion } from '@/lib/prescription';

export interface SessionInputs {
  recoveryScore: number | null;
  tsb: number | null;
  sleepDebtHours: number | null;
  windKmh: number | null;
  tempMax: number | null;
  plannedSport: string | null;
  plannedTss: number | null;
}

export function NextSessionCard({ inputs }: { inputs: SessionInputs }) {
  const verdict = computeVerdict({
    recoveryScore: inputs.recoveryScore,
    tsb: inputs.tsb,
    sleepDebtHours: inputs.sleepDebtHours,
  });
  const suggestion = nextSessionSuggestion({
    verdict,
    sleepDebtHours: inputs.sleepDebtHours,
    windy: (inputs.windKmh ?? 0) >= 30,
    hot: (inputs.tempMax ?? 0) >= 30,
    plannedSport: inputs.plannedSport,
    plannedTss: inputs.plannedTss,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Suggested Session</CardTitle>
      </CardHeader>
      <p className="text-sm text-foreground font-medium">{suggestion.title}</p>
      <p className="text-sm text-muted mt-1">{suggestion.detail}</p>
      {suggestion.reasons.length > 0 && (
        <details className="mt-2">
          <summary className="text-xs text-accent cursor-pointer hover:text-accent-hover">
            Why this suggestion?
          </summary>
          <ul className="mt-1 space-y-1">
            {suggestion.reasons.map((r) => (
              <li key={r} className="text-xs text-muted">• {r}</li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
