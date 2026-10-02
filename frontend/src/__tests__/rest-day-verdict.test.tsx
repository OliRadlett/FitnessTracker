/**
 * `RestDayBanner` with a server verdict (plan §1).
 *
 * The component had three inputs and rendered one thing, so there were three
 * ways for the verdict to be quietly dropped: a caller that forgets to pass it,
 * a headline that prefers the local title over the server's, and a consensus
 * that renders only the engines that had something to say. Each is pinned here.
 *
 * Component-level rather than page-level: `/today` pulls five other queries
 * (readiness, sleep debt, insights, plan week, forecast), so a page test would
 * be mostly mock scaffolding. The logic that changed lives in this component.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import type { EngineConsensus, RestDaySuggestion, TodayVerdict } from '@/lib/api/types';

import { RestDayBanner } from '@/components/dashboard/RestDayBanner';

function suggestion(over: Partial<RestDaySuggestion> = {}): RestDaySuggestion {
  return {
    should_rest: false,
    reasons: [],
    current_tsb: 5,
    latest_recovery: 78,
    consecutive_training_days: 2,
    ...over,
  };
}

function verdict(over: Partial<TodayVerdict> = {}): TodayVerdict {
  return {
    should_rest: false,
    headline: 'Go ahead with today’s plan.',
    reasons: [],
    consensus: [],
    projected_load: [],
    ...over,
  };
}

function row(over: Partial<EngineConsensus> = {}): EngineConsensus {
  return { engine: 'adaptive', available: true, stance: 'train', ...over };
}

describe('RestDayBanner with a verdict', () => {
  it('prefers the server headline over the locally derived title', () => {
    // The local title is a fixed string chosen from should_rest alone. The
    // server knows about four engines this component does not, so preferring
    // the local title would throw that away.
    render(
      <RestDayBanner
        suggestion={suggestion({ should_rest: true, reasons: ['Recovery low'] })}
        verdict={verdict({
          should_rest: true,
          headline: 'Take it easy — recovery is low.',
          reasons: ['Recovery 38% (below 40)'],
        })}
      />
    );
    expect(screen.getByText('Take it easy — recovery is low.')).toBeTruthy();
    expect(
      screen.queryByText('Consider a rest day today')
    ).toBeNull();
  });

  it('renders the verdict reasons rather than the legacy ones', () => {
    render(
      <RestDayBanner
        suggestion={suggestion({ reasons: ['stale legacy reason'] })}
        verdict={verdict({ reasons: ['Yesterday squat loaded legs'] })}
      />
    );
    expect(screen.getByText(/Yesterday squat loaded legs/)).toBeTruthy();
    expect(screen.queryByText(/stale legacy reason/)).toBeNull();
  });

  it('takes should_rest from the verdict, not the legacy field', () => {
    const { rerender } = render(
      <RestDayBanner
        suggestion={suggestion({ should_rest: false })}
        verdict={verdict({ should_rest: true, headline: 'Rest.' })}
      />
    );
    expect(screen.getByText('Rest.')).toBeTruthy();

    rerender(
      <RestDayBanner
        suggestion={suggestion({ should_rest: true })}
        verdict={verdict({ should_rest: false, headline: 'Go.' })}
      />
    );
    // Disagreement between the two inputs resolves in favour of the verdict.
    expect(screen.getByText('Go.')).toBeTruthy();
  });

  it('renders one row per engine, including the ones that had nothing to say', () => {
    render(
      <RestDayBanner
        suggestion={suggestion()}
        verdict={verdict({
          consensus: [
            row({ engine: 'rest_day_suggestion', stance: 'train', confidence: 'low' }),
            row({ engine: 'adaptive', stance: 'cut', confidence: 'high' }),
            row({
              engine: 'cross_domain',
              available: false,
              stance: null,
              reason: 'no analysis yet; runs weekly on Sundays',
            }),
            row({
              engine: 'deficiency',
              available: true,
              stance: 'train',
              reason: 'no critical or high weaknesses',
            }),
          ],
        })}
      />
    );

    // The summary counts what spoke out of what exists.
    expect(screen.getByText(/3 of 4 signals/)).toBeTruthy();

    // Labels, not raw engine ids.
    expect(screen.getByText('Load & recovery')).toBeTruthy();
    expect(screen.getByText('Sleep & cross-sport')).toBeTruthy();
    expect(screen.getByText('Weakness scan')).toBeTruthy();

    // An unavailable engine shows its reason, so "not run yet" is legible.
    expect(
      screen.getByText('no analysis yet; runs weekly on Sundays')
    ).toBeTruthy();

    // A stance is spelled out, not shown as an internal token.
    expect(screen.getByText('cut back')).toBeTruthy();
    expect(screen.queryByText('cut')).toBeNull();
  });

  it('hides a low-confidence tag so a weak signal is not dressed up', () => {
    render(
      <RestDayBanner
        suggestion={suggestion()}
        verdict={verdict({
          consensus: [row({ stance: 'train', confidence: 'low' })],
        })}
      />
    );
    expect(screen.getByText('train')).toBeTruthy();
    expect(screen.queryByText('low')).toBeNull();
  });

  it('shows a medium or high confidence tag', () => {
    render(
      <RestDayBanner
        suggestion={suggestion()}
        verdict={verdict({
          consensus: [row({ stance: 'rest', confidence: 'high' })],
        })}
      />
    );
    expect(screen.getByText('high')).toBeTruthy();
  });

  it('renders the week-ahead strip with TSB per day', () => {
    render(
      <RestDayBanner
        suggestion={suggestion()}
        verdict={verdict({
          projected_load: [
            { date: '2026-09-21', ctl: 60, atl: 55, tsb: 5 },
            { date: '2026-09-22', ctl: 61, atl: 62, tsb: -1 },
            { date: '2026-09-23', ctl: 62, atl: 70, tsb: -8 },
          ],
        })}
      />
    );
    expect(screen.getByText('Week ahead')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('-8')).toBeTruthy();
  });

  it('omits the strip when there is no projection', () => {
    render(
      <RestDayBanner suggestion={suggestion()} verdict={verdict()} />
    );
    expect(screen.queryByText('Week ahead')).toBeNull();
  });

  it('renders a dash for a projected day with no TSB', () => {
    render(
      <RestDayBanner
        suggestion={suggestion()}
        verdict={verdict({
          projected_load: [{ date: '2026-09-21', tsb: null }],
        })}
      />
    );
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('still works with no verdict at all', () => {
    // The Dashboard's weekly tab passes no verdict, and must keep rendering.
    render(
      <RestDayBanner suggestion={suggestion({ should_rest: true, reasons: ['TSB low'] })} />
    );
    expect(screen.getByText('Consider a rest day today')).toBeTruthy();
    expect(screen.getByText(/TSB low/)).toBeTruthy();
    expect(screen.queryByText('Week ahead')).toBeNull();
  });

  it('renders a verdict with an empty consensus without the Why section', () => {
    render(
      <RestDayBanner suggestion={suggestion()} verdict={verdict()} />
    );
    expect(screen.queryByText(/signals/)).toBeNull();
  });
});