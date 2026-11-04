import React from 'react';

/* ── Primitives ──────────────────────────────────────────────────────────────────
   The house primitives, re-expressed in the lab so the artifact is judged on
   layout and hierarchy rather than on a new visual language. */

export function Card({
  className = '',
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`rounded-xl border border-surface-light/50 bg-surface ${className}`}>
      {children}
    </section>
  );
}

export function SectionLabel({
  children,
  right,
  className = '',
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-baseline justify-between ${className}`}>
      <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">{children}</h2>
      {right}
    </div>
  );
}

export function Stat({
  label,
  value,
  unit,
  sub,
  tone = 'default',
  size = 'md',
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: React.ReactNode;
  tone?: 'default' | 'accent' | 'muted' | 'caution';
  size?: 'md' | 'lg';
}) {
  const toneClass =
    tone === 'accent'
      ? 'text-accent'
      : tone === 'caution'
        ? 'text-caution'
        : tone === 'muted'
          ? 'text-muted'
          : 'text-foreground';
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span
          className={`${size === 'lg' ? 'text-[34px]' : 'text-[22px]'} font-semibold tabular-nums leading-none ${toneClass}`}
        >
          {value}
        </span>
        {unit && <span className="text-[12px] text-muted">{unit}</span>}
      </div>
      {sub && <div className="mt-1.5 text-[12px] text-muted">{sub}</div>}
    </div>
  );
}

export function Chip({
  children,
  tone = 'neutral',
  title,
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'accent' | 'caution' | 'danger' | 'info';
  title?: string;
}) {
  const map = {
    neutral: 'border-surface-light text-muted',
    accent: 'border-accent/40 text-accent bg-accent/10',
    caution: 'border-caution/40 text-caution bg-caution/10',
    danger: 'border-warning/40 text-warning bg-warning/10',
    info: 'border-info/40 text-info bg-info/10',
  } as const;
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] leading-4 whitespace-nowrap ${map[tone]}`}
    >
      {children}
    </span>
  );
}

/** A status dot that is never the only carrier of meaning — it always sits beside a word. */
export function Dot({ tone }: { tone: 'accent' | 'caution' | 'danger' | 'muted' }) {
  const map = {
    accent: 'bg-accent',
    caution: 'bg-caution',
    danger: 'bg-warning',
    muted: 'bg-muted/40',
  } as const;
  return <span aria-hidden className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${map[tone]}`} />;
}
