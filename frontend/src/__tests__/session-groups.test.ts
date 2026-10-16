import { describe, expect, it } from 'vitest';

import type { Goal, TrainingWeekDay } from '@/lib/api';
import { goalsForPlanDate } from '@/components/goals/goalPlanLinks';
import { getCellStatus } from '@/components/training/dayCellShared';
import {
  addableSports,
  groupSessionsByDate,
  indexSessionsById,
  newSessionPayload,
  visibleSessions,
} from '@/lib/training/sessionGroups';

function session(
  id: string,
  day_date: string,
  sport: TrainingWeekDay['sport'],
  extra: Partial<TrainingWeekDay> = {},
): TrainingWeekDay {
  return {
    id,
    plan_id: 'p1',
    day_date,
    sport,
    planned_type: sport === 'rest' ? 'rest' : 'moderate',
    completed: false,
    ...extra,
  };
}

describe('groupSessionsByDate', () => {
  it('keeps every session on a date, in payload order', () => {
    const map = groupSessionsByDate([
      session('a', '2026-08-03', 'cycle'),
      session('b', '2026-08-04', 'strength'),
      session('c', '2026-08-04', 'cycle'),
    ]);
    expect(map.get('2026-08-03')?.map((s) => s.id)).toEqual(['a']);
    expect(map.get('2026-08-04')?.map((s) => s.id)).toEqual(['b', 'c']);
    expect(map.get('2026-08-05')).toBeUndefined();
  });

  it('tolerates a datetime-shaped day_date', () => {
    const map = groupSessionsByDate([session('a', '2026-08-03T00:00:00Z', 'cycle')]);
    expect(map.has('2026-08-03')).toBe(true);
  });
});

describe('indexSessionsById', () => {
  it('resolves a session by id regardless of its date', () => {
    const byId = indexSessionsById([
      session('a', '2026-08-03', 'cycle'),
      session('b', '2026-08-03', 'strength'),
    ]);
    expect(byId.get('b')?.sport).toBe('strength');
    expect(byId.get('zzz')).toBeUndefined();
  });
});

describe('visibleSessions', () => {
  it('shows one session as-is with no overflow', () => {
    const { shown, overflow } = visibleSessions([session('a', '2026-08-03', 'cycle')]);
    expect(shown.map((s) => s.id)).toEqual(['a']);
    expect(overflow).toBe(0);
  });

  it('caps at two chips and reports the rest as overflow', () => {
    const three = [
      session('a', '2026-08-03', 'cycle'),
      session('b', '2026-08-03', 'strength'),
      session('c', '2026-08-03', 'rest'),
    ];
    const { shown, overflow } = visibleSessions(three);
    expect(shown.map((s) => s.id)).toEqual(['a', 'b']);
    expect(overflow).toBe(1);
  });

  it('reports no overflow when the date holds exactly the cap', () => {
    const two = [
      session('a', '2026-08-03', 'cycle'),
      session('b', '2026-08-03', 'strength'),
    ];
    expect(visibleSessions(two).overflow).toBe(0);
  });
});

describe('addableSports', () => {
  it('offers the missing sport on a single-session date', () => {
    expect(addableSports([session('a', '2026-08-03', 'cycle')])).toEqual(['strength']);
    expect(addableSports([session('a', '2026-08-03', 'strength')])).toEqual(['cycle']);
  });

  it('offers nothing once the date holds every sport', () => {
    expect(
      addableSports([
        session('a', '2026-08-03', 'cycle'),
        session('b', '2026-08-03', 'strength'),
      ]),
    ).toEqual([]);
  });

  it('offers nothing on a rest day', () => {
    expect(addableSports([session('a', '2026-08-03', 'rest')])).toEqual([]);
  });
});

describe('newSessionPayload', () => {
  it('defaults a ride to an easy session', () => {
    expect(newSessionPayload('2026-08-03', 'cycle')).toEqual({
      day_date: '2026-08-03',
      sport: 'cycle',
      planned_type: 'easy',
    });
  });

  it('defaults a lift to a squat session', () => {
    expect(newSessionPayload('2026-08-03', 'strength')).toEqual({
      day_date: '2026-08-03',
      sport: 'strength',
      planned_type: 'moderate',
      planned_focus: 'squat',
    });
  });
});

describe('getCellStatus', () => {
  it('matches getStatus for a single session', () => {
    const missed = session('a', '2026-08-03', 'cycle', {
      day_date: '2026-08-03',
      day_status: 'missed',
    });
    expect(getCellStatus([missed], '2026-08-09')).toBe('missed');
    const done = session('a', '2026-08-03', 'cycle', { day_status: 'completed' });
    expect(getCellStatus([done], '2026-08-09')).toBe('done');
    const rest = session('a', '2026-08-09', 'rest');
    expect(getCellStatus([rest], '2026-08-09')).toBe('planned');
  });

  it('takes the worst session on a two-sport date', () => {
    const done = session('a', '2026-08-03', 'cycle', { day_status: 'completed' });
    const missed = session('b', '2026-08-03', 'strength', { day_status: 'missed' });
    expect(getCellStatus([done, missed], '2026-08-09')).toBe('missed');
  });

  it('is neutral for an empty date', () => {
    expect(getCellStatus([], '2026-08-09')).toBe('neutral');
  });
});

describe('goalsForPlanDate', () => {
  function goal(id: string, over: Partial<Goal> = {}): Goal {
    return {
      id,
      user_id: 'u1',
      metric: 'ftp_watts',
      metric_label: 'FTP',
      status: 'active',
      starting_value: 200,
      target_value: 300,
      current_value: 250,
      target_date: '2026-12-31',
      ...over,
    } as Goal;
  }

  it('unions the goals of every session on the date', () => {
    const cycling = goal('g-cycle', { metric: 'ftp_watts' });
    const lifting = goal('g-lift', { metric: 'squat_1rm' });
    const ride = session('a', '2026-08-03', 'cycle');
    const lift = session('b', '2026-08-03', 'strength');

    expect(goalsForPlanDate([cycling], [ride, lift]).map((g) => g.id)).toEqual(['g-cycle']);
    expect(goalsForPlanDate([cycling, lifting], [ride, lift]).map((g) => g.id)).toEqual([
      'g-cycle',
      'g-lift',
    ]);
  });

  it('counts a goal once when both sessions match it', () => {
    const sessions = goal('g-sessions', { metric: 'weekly_sessions', metric_label: 'Sessions' });
    const both = [
      session('a', '2026-08-03', 'cycle'),
      session('b', '2026-08-03', 'strength'),
    ];
    expect(goalsForPlanDate([sessions], both).map((g) => g.id)).toEqual(['g-sessions']);
  });

  it('ignores rest sessions', () => {
    const ride = goal('g-cycle', { metric: 'ftp_watts' });
    expect(goalsForPlanDate([ride], [session('a', '2026-08-03', 'rest')])).toEqual([]);
  });
});
