import type { LiftingSession, LiftingSet, PersonalRecord } from '@/lib/api/types/lifting';
import { brzycki1rm } from '@/lib/lifting/reference';

export const focusOf = (session: Pick<LiftingSession, 'focus'>) => {
  const focus = (session.focus ?? '').trim();
  return focus.length ? focus : 'Session';
};

const localDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return localDate(d);
};

export const mondayOf = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`);
  const offset = (d.getDay() + 6) % 7;
  return addDays(iso, -offset);
};

export const weekBounds = (today: string) => {
  const start = mondayOf(today);
  return { start, end: addDays(start, 6) };
};

export const sessionsInRange = (sessions: LiftingSession[], start: string, end: string) =>
  sessions.filter((s) => s.session_date >= start && s.session_date <= end);

export const sumVolume = (sessions: LiftingSession[]) =>
  sessions.reduce((a, s) => a + (s.total_volume_kg ?? 0), 0);

export const sumSets = (sessions: LiftingSession[]) =>
  sessions.reduce((a, s) => a + (s.sets?.length ?? 0), 0);

export const sumTss = (sessions: LiftingSession[]) =>
  sessions.reduce((a, s) => a + (s.estimated_tss ?? 0), 0);

export const bestPr = (prs: PersonalRecord[], exercise: string): PersonalRecord | null => {
  const list = prs.filter((p) => p.exercise_name === exercise && p.record_type === '1rm');
  if (list.length === 0) return null;
  return list.reduce((a, b) =>
    (b.estimated_1rm ?? b.weight_kg) > (a.estimated_1rm ?? a.weight_kg) ? b : a,
  );
};

export const prsInRange = (prs: PersonalRecord[], start: string, end: string) =>
  prs.filter((p) => p.achieved_date >= start && p.achieved_date <= end);

export const prsFor = (prs: PersonalRecord[], exercise: string) =>
  prs
    .filter((p) => p.exercise_name === exercise)
    .slice()
    .sort((a, b) => (a.achieved_date < b.achieved_date ? -1 : 1));

export const recentPrCount = (prs: PersonalRecord[], sessionId: string) =>
  prs.filter((p) => p.session_id === sessionId).length;

export const topSet = (session: LiftingSession): LiftingSet | null => {
  const working = (session.sets ?? []).filter((s) => !s.is_warmup);
  if (working.length === 0) return null;
  return working.reduce((a, b) => (b.weight_kg > a.weight_kg ? b : a));
};

export const groupSets = (session: LiftingSession) => {
  const order: string[] = [];
  const map = new Map<string, LiftingSet[]>();
  for (const set of session.sets ?? []) {
    if (!map.has(set.exercise_name)) {
      map.set(set.exercise_name, []);
      order.push(set.exercise_name);
    }
    map.get(set.exercise_name)!.push(set);
  }
  return order.map((name) => ({
    name,
    sets: map.get(name)!.slice().sort((a, b) => {
      const ai = a.order_index ?? a.set_number;
      const bi = b.order_index ?? b.set_number;
      return ai === bi ? a.set_number - b.set_number : ai - bi;
    }),
  }));
};

export const previousSameFocus = (session: LiftingSession, all: LiftingSession[]) => {
  const focus = focusOf(session);
  return (
    all.find(
      (s) => s.session_date < session.session_date && focusOf(s) === focus,
    ) ?? null
  );
};

export const volumeDeltaPct = (session: LiftingSession, all: LiftingSession[]) => {
  const prev = previousSameFocus(session, all);
  if (!prev?.total_volume_kg || !session.total_volume_kg) return null;
  return ((session.total_volume_kg - prev.total_volume_kg) / prev.total_volume_kg) * 100;
};

export const amount = (n: number) =>
  n.toLocaleString('en-GB', { maximumFractionDigits: n % 1 ? 1 : 0 });

export const shortWeight = (n: number | null | undefined) => {
  if (n == null) return '—';
  return n >= 10_000 ? `${(n / 1000).toFixed(1)}t` : `${amount(n)} kg`;
};

export const big3Total = (prs: PersonalRecord[]) =>
  ['Back Squat', 'Bench Press', 'Deadlift'].reduce(
    (sum, name) => sum + (bestPr(prs, name)?.estimated_1rm ?? 0),
    0,
  );

export const dotsScore = (total: number, bodyweightKg: number | null) => {
  if (!bodyweightKg || !total) return null;
  const bw = bodyweightKg;
  const denom =
    -0.000001093 * bw ** 4 +
    0.0007391293 * bw ** 3 -
    0.1918759221 * bw ** 2 +
    24.0900756 * bw -
    307.75076;
  return (total * 500) / denom;
};

export const e1rm = (weight: number, reps: number) => brzycki1rm(weight, reps) ?? weight;
