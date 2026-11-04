/**
 * The stance composer is the dashboard's honesty gate.
 *
 * These tests exist because the page shipped a confident sentence that its own
 * payload contradicted. Anything that can produce the headline is pinned here.
 */

import { describe, expect, it } from 'vitest';
import type { DailyLoadPoint, EngineConsensus, TodayVerdict } from '@/lib/api';
import {
  engineTally,
  humaniseReason,
  readDayContext,
  readEngines,
  readStance,
  stanceMentionsAPlan,
  type DayContext,
} from '@/lib/dashboard/stance';

const NO_VERDICT = null;

function day(over: Partial<DayContext> = {}): DayContext {
  return {
    date: '2026-11-04',
    ctl: 19.4,
    atl: 17.3,
    tsb: 2.1,
    hrvMs: 50,
    recoveryScore: 85,
    isScored: true,
    ...over,
  };
}

function verdict(over: Partial<TodayVerdict> = {}): TodayVerdict {
  return {
    should_rest: false,
    headline: "Go ahead with today's plan.",
    reasons: [],
    consensus: [],
    projected_load: [],
    ...over,
  };
}

function engine(over: Partial<EngineConsensus> = {}): EngineConsensus {
  return {
    engine: 'rest_day_suggestion',
    stance: 'train',
    confidence: 'low',
    available: true,
    reason: null,
    note: null,
    analyzed_at: null,
    ...over,
  };
}

describe('readDayContext', () => {
  const load: DailyLoadPoint[] = [
    { date: '2026-10-27', tss: 128, ctl: 24.1, atl: 30.2, tsb: -6.1 },
    { date: '2026-11-04', tss: 0, ctl: 19.4, atl: 17.3, tsb: 2.1 },
  ];

  it('reads the pinned day from the series, not "today"', () => {
    const today = readDayContext({ date: '2026-11-04', load, hrvPoints: [], readiness: undefined });
    const ride = readDayContext({ date: '2026-10-27', load, hrvPoints: [], readiness: undefined });
    expect(today.tsb).toBeCloseTo(2.1);
    expect(ride.tsb).toBeCloseTo(-6.1);
  });

  it('only claims a recovery score for the day it was computed for', () => {
    const scored = readDayContext({
      date: '2026-11-04',
      load,
      hrvPoints: [],
      readiness: { date: '2026-11-04', recovery_score: 85 },
    });
    const unscored = readDayContext({
      date: '2026-10-27',
      load,
      hrvPoints: [],
      readiness: { date: '2026-11-04', recovery_score: 85 },
    });
    expect(scored.recoveryScore).toBe(85);
    expect(unscored.recoveryScore).toBeNull();
    expect(unscored.isScored).toBe(false);
  });

  it('returns nulls rather than zeros when a day is missing', () => {
    const ctx = readDayContext({ date: '2026-01-01', load, hrvPoints: [], readiness: undefined });
    expect(ctx.tsb).toBeNull();
    expect(ctx.hrvMs).toBeNull();
  });
});

describe('readStance', () => {
  it('says there is no basis rather than guessing, with no load data', () => {
    const reading = readStance({
      verdict: NO_VERDICT,
      context: day({ tsb: null, ctl: null, atl: null, recoveryScore: null, isScored: false }),
    });
    expect(reading.reason.toLowerCase()).toContain('nothing to base a call on');
  });

  it('goes easy on a deep negative form', () => {
    const reading = readStance({ verdict: NO_VERDICT, context: day({ tsb: -24.5 }) });
    expect(reading.stance).toBe('easy');
    expect(reading.reason).toContain('\u221224.5');
  });

  it('allows a hard day on a positive form', () => {
    const reading = readStance({ verdict: NO_VERDICT, context: day({ tsb: 18 }) });
    expect(reading.stance).toBe('train');
    expect(reading.reason).toContain('room to load');
  });

  it('follows a rest verdict and quotes its reason', () => {
    const reading = readStance({
      verdict: verdict({ should_rest: true, reasons: ['recovery 31% is below the floor'] }),
      context: day({ tsb: 5 }),
    });
    expect(reading.stance).toBe('rest');
    expect(reading.reason).toContain('recovery 31%');
  });

  it('NEVER echoes the API headline, even when the API claims a plan', () => {
    // The bug: the payload said this while `projection` reported "no active plan".
    const reading = readStance({ verdict: verdict(), context: day() });
    expect(stanceMentionsAPlan(reading)).toBe(false);
    expect(reading.reason.toLowerCase()).not.toContain('plan');
  });

  it('states how many engines actually contributed', () => {
    const reading = readStance({
      verdict: verdict({
        consensus: [
          engine({ engine: 'a', available: true }),
          engine({ engine: 'b', available: false, reason: 'no active plan' }),
          engine({ engine: 'c', available: false, reason: 'no labelled sessions' }),
        ],
      }),
      context: day(),
    });
    expect(reading.reason).toContain('1 of 3 engines contributed');
    expect(reading.reason).toContain('2 are silent');
  });
});

describe('readEngines', () => {
  it('turns a raw exception into a sentence and keeps the text for a tooltip', () => {
    const [row] = readEngines(
      verdict({
        consensus: [
          engine({
            engine: 'adaptive',
            available: false,
            reason: "AttributeError: 'str' object has no attribute 'get'",
          }),
        ],
      }),
    );
    expect(row.state).toBe('broken');
    expect(row.detail).toBe('engine failed — reported, not hidden');
    expect(row.detail).not.toContain('AttributeError');
    expect(row.raw).toContain('AttributeError');
  });

  it('marks a real absence as silent, not broken', () => {
    const [row] = readEngines(
      verdict({ consensus: [engine({ available: false, reason: 'no active plan' })] }),
    );
    expect(row.state).toBe('silent');
    expect(row.detail).toBe('no plan running');
    expect(row.raw).toBeUndefined();
  });

  it('labels every known engine', () => {
    const rows = readEngines(
      verdict({
        consensus: [
          'rest_day_suggestion',
          'adaptive',
          'deficiency',
          'cross_domain',
          'projection',
          'session_mix',
        ].map((name) => engine({ engine: name })),
      }),
    );
    expect(rows.map((r) => r.label)).toEqual([
      'Rest-day',
      'Adaptive plan',
      'Weakness',
      'Cross-domain',
      'Plan projection',
      'Session mix',
    ]);
  });

  it('survives a null verdict', () => {
    expect(readEngines(null)).toEqual([]);
  });
});

describe('humaniseReason', () => {
  it.each([
    ['no analysis yet; runs weekly on Sundays', 'no weekly run yet'],
    ['no active plan', 'no plan running'],
    ['no classified sessions yet', 'no labelled sessions'],
    ['rest-day signal not computed', 'input missing'],
    [null, 'said nothing'],
  ])('%s -> %s', (input, expected) => {
    expect(humaniseReason(input)).toBe(expected);
  });
});

describe('engineTally', () => {
  it('counts each state', () => {
    const rows = readEngines(
      verdict({
        consensus: [
          engine({ engine: 'a', available: true }),
          engine({ engine: 'b', available: false, reason: 'no active plan' }),
          engine({ engine: 'c', available: false, reason: 'ValueError: boom' }),
        ],
      }),
    );
    expect(engineTally(rows)).toEqual({ contributing: 1, silent: 1, broken: 1, total: 3 });
  });
});
