'use client';

/**
 * The cross-domain band: cycling load and HRV on one shared x-axis.
 *
 * Two SVGs on the same viewBox so the columns line up exactly, and a non-scaling
 * stroke so the responsive stretch does not fatten the line. A day with no activity
 * keeps a stub bar, because "zero" and "missing" are different claims.
 */

import type { DayLoad } from '@/lib/dashboard/useDashboardPage';

const COL = 100;
const LOAD_H = 46;
const HRV_H = 30;

const ACCENT = 'rgb(16 185 129)';
const INFO = 'rgb(56 189 248)';

export function DomainStrip({ days }: { days: DayLoad[] }) {
  if (days.length === 0) {
    return (
      <p className="text-[12px] text-muted">
        No daily load in this window yet. It fills in as rides and sessions are recorded.
      </p>
    );
  }

  const n = days.length;
  const slot = COL / n;
  const gap = Math.max(0.4, slot * 0.22);
  const barW = Math.max(0.4, slot - gap * 2);

  const maxTss = Math.max(...days.map((d) => d.tss), 1);
  const hrvValues = days.map((d) => d.hrv).filter((v): v is number => typeof v === 'number');
  const lo = hrvValues.length ? Math.min(...hrvValues) : 30;
  const hi = hrvValues.length ? Math.max(...hrvValues) : 70;
  const pad = Math.max(2, (hi - lo) * 0.18);
  const hrvMin = lo - pad;
  const hrvMax = hi + pad;
  const span = hrvMax - hrvMin || 1;
  const top = 4;
  const bottom = HRV_H - 4;

  const points = days
    .map((d, i) => {
      if (typeof d.hrv !== 'number') return null;
      const x = i * slot + slot / 2;
      const y = bottom - ((d.hrv - hrvMin) / span) * (bottom - top);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .filter(Boolean)
    .join(' ');

  return (
    <figure>
      <svg
        viewBox={`0 0 ${COL} ${LOAD_H}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height: LOAD_H }}
        role="img"
        aria-label={`Daily cycling load and HRV for the last ${n} days`}
      >
        <line
          x1={0}
          y1={LOAD_H - 0.5}
          x2={COL}
          y2={LOAD_H - 0.5}
          stroke="rgba(255,255,255,0.10)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        {days.map((d, i) => {
          const h = d.tss > 0 ? Math.max(2.5, (d.tss / maxTss) * (LOAD_H - 3)) : 1.2;
          return (
            <rect
              key={d.date}
              x={i * slot + gap}
              y={LOAD_H - h}
              width={barW}
              height={h}
              rx={0.8}
              fill={d.tss > 0 ? ACCENT : 'rgba(255,255,255,0.10)'}
            >
              <title>{`${d.date} · ${Math.round(d.tss)} TSS`}</title>
            </rect>
          );
        })}
      </svg>

      <svg
        viewBox={`0 0 ${COL} ${HRV_H}`}
        preserveAspectRatio="none"
        className="mt-0.5 w-full"
        style={{ height: HRV_H }}
        aria-hidden
      >
        <line
          x1={0}
          y1={HRV_H - 0.5}
          x2={COL}
          y2={HRV_H - 0.5}
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        {points && (
          <polyline
            points={points}
            fill="none"
            stroke={INFO}
            strokeWidth={1.3}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
          />
        )}
        {days.map((d, i) =>
          typeof d.hrv === 'number' ? (
            <circle
              key={d.date}
              cx={i * slot + slot / 2}
              cy={bottom - ((d.hrv - hrvMin) / span) * (bottom - top)}
              r={0.6}
              fill={INFO}
            >
              <title>{`${d.date} · HRV ${Math.round(d.hrv)} ms`}</title>
            </circle>
          ) : null,
        )}
      </svg>

      <figcaption className="mt-1.5 flex">
        {days.map((d, i) => (
          <span
            key={d.date}
            className="min-w-0 flex-1 text-center text-[10px] leading-none text-muted"
          >
            {i % 2 === 0 ? d.date.slice(8) : ''}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
