'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type { ChartData } from '@/lib/api';
import { CHART_AXIS, CHART_GRID } from '@/components/charts/chartTheme';

const CYCLING = '#38bdf8';
const LIFTING = '#a78bfa';
const TEXT = '#e6e6e6';

const monday = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`);
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const shortDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/**
 * Combined load hero: weekly cycling vs lifting TSS as a stacked bar, last 10
 * weeks. Replaces the 181-point daily line chart whose legend collided with the
 * axis. Lifting TSS is a duration × RPE estimate (same order as cycling TSS).
 */
export function CombinedLoadHero() {
  const { authFetch, token } = useAuthFetch();
  const { data } = useQuery<ChartData>({
    queryKey: ['chart-combined-load', 90],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/combined_training_load?days=90'),
    enabled: !!token,
    staleTime: 300_000,
  });

  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(560);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry?.contentRect.width;
      if (w && w > 0) setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const weekly = React.useMemo(() => {
    if (!data) return [];
    const cycling = data.series.find((s) => /cycling/i.test(s.name));
    const lifting = data.series.find((s) => /lifting/i.test(s.name));
    const buckets = new Map<string, { cycling: number; lifting: number }>();
    data.labels.forEach((label, i) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(label)) return;
      const key = monday(label);
      const b = buckets.get(key) ?? { cycling: 0, lifting: 0 };
      b.cycling += Number(cycling?.data[i] ?? 0);
      b.lifting += Number(lifting?.data[i] ?? 0);
      buckets.set(key, b);
    });
    return [...buckets.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .slice(-10)
      .map(([date, v]) => ({ date, ...v, total: v.cycling + v.lifting }));
  }, [data]);

  const W = Math.max(300, width);
  const H = 230;
  const padL = 38;
  const padR = 10;
  const padT = 22;
  const padB = 26;
  const max = Math.max(1, ...weekly.map((w) => w.total)) * 1.12;
  const y = (v: number) => H - padB - (v / max) * (H - padT - padB);
  const step = (W - padL - padR) / Math.max(1, weekly.length);
  const bw = Math.min(34, step * 0.55);
  const ticks = [0, 0.5, 1].map((f) => f * max);
  const liftingShare = weekly.reduce((a, b) => a + b.total, 0)
    ? Math.round((weekly.reduce((a, b) => a + b.lifting, 0) / weekly.reduce((a, b) => a + b.total, 0)) * 100)
    : null;

  return (
    <section className="rounded-xl border border-surface-light/60 bg-surface/50 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-[15px] font-semibold">Combined training load</h3>
          <p className="mt-0.5 text-[12px] text-muted">
            Weekly cycling + lifting TSS
            {liftingShare != null ? ` · lifting is ${liftingShare}% of the last 10 weeks` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3 text-[12px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: CYCLING }} /> Cycling
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: LIFTING }} /> Lifting
          </span>
        </div>
      </div>

      {weekly.length === 0 ? (
        <p className="py-10 text-center text-[12px] text-muted">No combined load yet.</p>
      ) : (
        <div ref={ref} className="mt-2 w-full">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Weekly cycling and lifting training load">
            {ticks.map((t, i) => (
              <g key={i}>
                <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={CHART_GRID} strokeDasharray="3 4" />
                <text x={padL - 8} y={y(t) + 3} textAnchor="end" fontSize={12} fill={CHART_AXIS}>
                  {Math.round(t)}
                </text>
              </g>
            ))}
            {weekly.map((w, i) => {
              const cx = padL + step * i + step / 2;
              const cy = y(w.cycling);
              const ly = y(w.cycling + w.lifting);
              return (
                <g key={w.date}>
                  <rect x={cx - bw / 2} y={cy} width={bw} height={Math.max(1, H - padB - cy)} fill={CYCLING} opacity={0.85} rx={2} />
                  <rect x={cx - bw / 2} y={ly} width={bw} height={Math.max(1, cy - ly)} fill={LIFTING} opacity={0.9} rx={2} />
                  {i === weekly.length - 1 && (
                    <text x={cx} y={ly - 6} textAnchor="middle" fontSize={12} fill={TEXT} fontWeight={600}>
                      {Math.round(w.total)}
                    </text>
                  )}
                  {i === 0 || i === Math.floor((weekly.length - 1) / 2) || i === weekly.length - 1 ? (
                    <text x={cx} y={H - 6} textAnchor="middle" fontSize={12} fill={CHART_AXIS}>
                      {shortDate(w.date)}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
        </div>
      )}
      <p className="mt-1 text-[12px] text-muted">Lifting TSS is a duration × RPE estimate, same order as cycling TSS.</p>
    </section>
  );
}
