'use client';

import React from 'react';
import {
  Activity,
  Bike,
  Dumbbell,
  Footprints,
  Moon,
  Waves,
  type LucideIcon,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { IconButton } from '@/components/ui/Button';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { SkeletonLine } from '@/components/ui/Skeleton';
import type { Status } from '@/lib/calendar';
import { statusLabel, statusTone } from '@/lib/calendar';

export { Card, IconButton, SectionLabel };
export const Skeleton = SkeletonLine;

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function sportIcon(sport: string | null | undefined): LucideIcon {
  const s = (sport ?? '').toLowerCase();
  if (s === 'cycle' || s.includes('cycl') || s.includes('bike')) return Bike;
  if (s === 'strength' || s.includes('strength') || s.includes('weight')) return Dumbbell;
  if (s === 'rest') return Moon;
  if (s.includes('run') || s.includes('walk') || s.includes('hik')) return Footprints;
  if (s.includes('swim')) return Waves;
  return Activity;
}

export function SportGlyph({
  sport,
  className,
}: {
  sport: string | null | undefined;
  className?: string;
}) {
  const Icon = sportIcon(sport);
  return <Icon className={cx('h-3 w-3 shrink-0', className)} aria-hidden="true" />;
}

const TONE_TEXT: Record<string, string> = {
  good: 'text-positive',
  caution: 'text-caution',
  bad: 'text-warning',
  info: 'text-info',
  muted: 'text-muted',
};

const TONE_BG: Record<string, string> = {
  good: 'bg-positive/10 border-positive/25 text-positive',
  caution: 'bg-caution/10 border-caution/30 text-caution',
  bad: 'bg-warning/10 border-warning/30 text-warning',
  info: 'bg-info/10 border-info/25 text-info',
  muted: 'bg-surface-light/30 border-surface-light text-muted',
};

export function toneText(tone: string): string {
  return TONE_TEXT[tone] ?? TONE_TEXT.muted;
}

export function StatusPill({
  status,
  className,
}: {
  status: Status;
  className?: string;
}) {
  const tone = statusTone(status);
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-4',
        TONE_BG[tone],
        className,
      )}
    >
      {statusLabel(status)}
    </span>
  );
}

export function Pill({
  children,
  tone = 'muted',
  className,
}: {
  children: React.ReactNode;
  tone?: string;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-4',
        TONE_BG[tone] ?? TONE_BG.muted,
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex rounded-xl border border-surface-light bg-surface-light/25 p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={cx(
            'h-9 rounded-[10px] px-3 text-xs font-semibold transition-colors',
            value === option.value
              ? 'bg-accent/15 text-foreground shadow-[0_0_0_1px_rgba(16,185,129,0.25)_inset]'
              : 'text-muted hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function RecoveryDot({
  score,
  className,
}: {
  score: number | null | undefined;
  className?: string;
}) {
  const tone = score == null ? 'none' : score >= 67 ? 'good' : score >= 34 ? 'caution' : 'bad';
  if (tone === 'none') return null;
  const color =
    tone === 'good' ? 'bg-positive' : tone === 'caution' ? 'bg-caution' : 'bg-warning';
  return (
    <span
      className={cx('inline-block h-1.5 w-1.5 shrink-0 rounded-full', color, className)}
      title={score == null ? undefined : `Recovery ${Math.round(score)}%`}
      aria-hidden="true"
    />
  );
}
