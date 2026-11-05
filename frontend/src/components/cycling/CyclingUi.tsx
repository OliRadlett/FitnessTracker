'use client';

/**
 * Presentational pieces for the cycling page. Small and local: the shared
 * `Card`/`PageHeader`/`SegmentedControl` do the layout, these do the numbers.
 */

export const TYPE_COLOR: Record<string, string> = {
  recovery: '#60a5fa',
  endurance: '#22c55e',
  tempo: '#3b82f6',
  threshold: '#f59e0b',
  vo2max: '#ef4444',
  unclassified: '#64748b',
};

export const TYPE_TINT: Record<string, string> = {
  recovery: 'bg-blue-400/10 text-blue-300',
  endurance: 'bg-positive/10 text-positive',
  tempo: 'bg-blue-500/10 text-blue-400',
  threshold: 'bg-caution/10 text-caution',
  vo2max: 'bg-warning/10 text-warning',
  unclassified: 'bg-surface-light/40 text-muted',
};

export const num = (v: number | null | undefined, digits = 0): string =>
  v == null || Number.isNaN(v)
    ? '—'
    : v.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const signed = (v: number | null | undefined, digits = 1, suffix = ''): string =>
  v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}${suffix}`;

export function Panel({
  children,
  className = '',
  anchor,
}: {
  children: React.ReactNode;
  className?: string;
  anchor?: string;
}) {
  return (
    <section
      data-anchor={anchor}
      className={`rounded-xl border border-surface-light/50 bg-surface/70 ${className}`}
    >
      {children}
    </section>
  );
}

export function PanelHead({ title, hint, right }: { title: string; hint?: string; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 className="text-[13px] font-semibold tracking-tight text-foreground">{title}</h2>
      {hint && <p className="text-[12px] text-muted">{hint}</p>}
      {right}
    </div>
  );
}

/** The one number. */
export function Hero({
  value,
  unit,
  label,
  note,
  tone = 'text-foreground',
}: {
  value: string;
  unit?: string;
  label: string;
  note?: React.ReactNode;
  tone?: string;
}) {
  return (
    <div>
      <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">{label}</p>
      <p className="mt-1 flex items-baseline gap-2">
        <span className={`text-[52px] font-semibold leading-none tracking-tight tabular-nums ${tone}`}>{value}</span>
        {unit && <span className="text-[13px] text-muted">{unit}</span>}
      </p>
      {note && <div className="mt-2 text-[12px] text-muted">{note}</div>}
    </div>
  );
}

export function Metric({
  label,
  value,
  sub,
  tone = 'text-foreground',
  align = 'left',
}: {
  label: string;
  value: string;
  sub?: string | null;
  tone?: string;
  align?: 'left' | 'right';
}) {
  return (
    <div className={align === 'right' ? 'text-right' : ''}>
      <p className="text-[12px] uppercase tracking-[0.07em] text-muted">{label}</p>
      <p className={`mt-0.5 text-[19px] font-semibold leading-tight tabular-nums ${tone}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[12px] text-muted">{sub}</p>}
    </div>
  );
}

export function Delta({
  value,
  digits = 0,
  suffix = '',
  invert = false,
}: {
  value: number | null;
  digits?: number;
  suffix?: string;
  invert?: boolean;
}) {
  if (value == null) return <span className="text-[12px] text-muted">—</span>;
  const good = invert ? value < 0 : value > 0;
  const tone = Math.abs(value) < 0.5 ? 'text-muted' : good ? 'text-positive' : 'text-warning';
  return (
    <span className={`text-[12px] font-medium tabular-nums ${tone}`}>
      {value > 0 ? '▲ ' : value < 0 ? '▼ ' : ''}
      {signed(value, digits, suffix)}
    </span>
  );
}

export function TypeChip({ type }: { type: string | null }) {
  const key = type ?? 'unclassified';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-medium ${TYPE_TINT[key] ?? TYPE_TINT.unclassified}`}>
      {type ?? 'unclassified'}
    </span>
  );
}

export function Bar({ pct, color, height = 6 }: { pct: number; color: string; height?: number }) {
  return (
    <div className="w-full overflow-hidden rounded-full bg-surface-light/40" style={{ height }}>
      <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
    </div>
  );
}
