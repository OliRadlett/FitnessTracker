export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null || seconds <= 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function fmtDistance(meters: number | null | undefined): string {
  if (meters == null || meters <= 0) return '—';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1)} km`;
}

export function fmtTss(tss: number | null | undefined): string {
  if (tss == null) return '—';
  return `${Math.round(tss)} TSS`;
}

export function fmtLoad(tss: number | null | undefined): string {
  if (tss == null) return '—';
  return Math.round(tss).toLocaleString('en-GB');
}

export function fmtVolume(kg: number | null | undefined): string {
  if (kg == null || kg <= 0) return '—';
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)}t`;
  return `${Math.round(kg)} kg`;
}

export function fmtHours(minutes: number | null | undefined): string {
  if (minutes == null || minutes <= 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h === 0 ? `${m}m` : `${h}h ${m}m`;
}

export function fmtSleepSeconds(seconds: number | null | undefined): string {
  if (seconds == null || seconds <= 0) return '—';
  return fmtHours(seconds / 60);
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

export function fmtPercent(value: number | null | undefined, digits = 0): string {
  if (value == null) return '—';
  return `${value.toFixed(digits)}%`;
}

export function fmtSigned(value: number | null | undefined, digits = 1): string {
  if (value == null) return '—';
  const rounded = value.toFixed(digits);
  return value > 0 ? `+${rounded}` : rounded;
}

export function sportLabel(sport: string | null | undefined): string {
  const s = (sport ?? '').toLowerCase();
  if (s === 'cycle' || s.includes('cycl') || s.includes('bike')) return 'Cycling';
  if (s === 'strength' || s.includes('strength') || s.includes('weight')) return 'Strength';
  if (s.includes('run')) return 'Running';
  if (s.includes('swim')) return 'Swimming';
  if (s.includes('walk') || s.includes('hik')) return 'Walking';
  if (s === 'rest') return 'Rest';
  return sport ? sport.replace(/_/g, ' ') : '—';
}

const FOCUS_LABELS: Record<string, string> = {
  push: 'Push',
  pull: 'Pull',
  legs: 'Legs',
  upper: 'Upper',
  lower: 'Lower',
  full_body: 'Full body',
  squat: 'Squat',
  bench: 'Bench',
  deadlift: 'Deadlift',
  overhead_press: 'Overhead press',
  accessories: 'Accessories',
  accessory: 'Accessories',
  none: 'No focus',
};

export function focusLabel(focus: string | null | undefined): string {
  if (!focus) return 'Strength';
  return FOCUS_LABELS[focus.toLowerCase()] ?? focus;
}

export function titleCase(value: string): string {
  return value.replace(/\b\w/g, (c) => c.toUpperCase());
}
