'use client';

/**
 * Form — the one number and its direction. Answers "how fit am I, which way is it
 * moving, and what did I do this week?" and nothing else: no prescription (that
 * is /training), no device setup (that is /settings).
 */
import React from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { BarSeries } from '@/components/charts/BarSeries';
import { LineSeries } from '@/components/charts/LineSeries';
import { Spark } from '@/components/charts/Spark';
import type { ChartData, CyclingMetricsSummary, CyclingProfile, TrainingLoadResponse } from '@/lib/api';
import type { RideRow, WeekBucket } from '@/lib/cycling/selectors';
import { ctlChange, formatDayDate, formatShortDate, formatDuration, tsbWord, weekStats } from '@/lib/cycling/selectors';
import { Delta, Hero, Metric, Panel, PanelHead, TypeChip, num, signed, TYPE_COLOR } from './CyclingUi';

export interface FormModeProps {
  profile?: CyclingProfile;
  metrics?: CyclingMetricsSummary;
  load?: TrainingLoadResponse;
  ramp?: ChartData;
  rides: RideRow[];
  buckets: WeekBucket[];
  onOpenRide: (id: string) => void;
}

export function FormMode({ profile, metrics, load, ramp, rides, buckets, onOpenRide }: FormModeProps) {
  const points = load?.data ?? [];
  const ctl = load?.current_ctl ?? 0;
  const atl = load?.current_atl ?? 0;
  const tsb = load?.current_tsb ?? 0;
  const since = ctlChange(points, Math.min(90, points.length));
  const stats = metrics ? weekStats(metrics) : [];

  const rampValues = (ramp?.series?.[0]?.data ?? []).map((v) => (v == null ? null : Number(v))).slice(-13);
  const rampLabels = (ramp?.labels ?? []).slice(-13).map((l) => formatShortDate(l));
  const lastRamp = [...rampValues].reverse().find((v) => v != null) ?? null;

  const recent = rides.slice(0, 5);
  const maxBucket = Math.max(1, ...buckets.map((b) => b.total));
  const unclassified = rides.filter((r) => !r.rideType).length;

  return (
    <div className="space-y-4">
      <Panel className="p-4 sm:p-5">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <Hero
                label="Fitness · CTL"
                value={num(ctl, 1)}
                note={
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Delta value={since?.delta ?? null} digits={1} />
                    <span>since {since ? formatShortDate(since.fromISO) : '—'}</span>
                  </span>
                }
              />
              <div className="flex gap-6 sm:gap-8">
                <Metric
                  label="Form · TSB"
                  value={signed(tsb, 1)}
                  sub={tsbWord(tsb)}
                  tone={tsb > 3 ? 'text-positive' : tsb < -10 ? 'text-warning' : 'text-foreground'}
                />
                <Metric label="Fatigue · ATL" value={num(atl, 1)} sub={`${signed(atl - ctl, 1)} vs fitness`} />
                <Metric
                  label="Ramp"
                  value={signed(lastRamp, 1)}
                  sub="CTL / week"
                  tone={lastRamp != null && lastRamp < -2 ? 'text-warning' : 'text-foreground'}
                />
              </div>
            </div>

            <div className="mt-4">
              <LineSeries
                labels={points.map((p) => formatShortDate(p.date))}
                series={[
                  { name: 'CTL', color: '#22c55e', points: points.map((p, i) => ({ x: i, y: p.ctl })) },
                  { name: 'ATL', color: '#60a5fa', points: points.map((p, i) => ({ x: i, y: p.atl })) },
                ]}
                height={320}
                yTitle="Load · TSS per day"
                zeroAxis
                maxTicks={6}
              />
              <p className="mt-1 text-[12px] text-muted">
                Fitness (CTL) and fatigue (ATL) over {points.length} days. Form is fitness minus fatigue — it turns
                positive after a few easy days, not because you got fitter.
              </p>
            </div>
          </div>

          <div className="space-y-3 lg:border-l lg:border-surface-light/40 lg:pl-5">
            <div>
              <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">Threshold</p>
              <div className="mt-2 space-y-3">
                <Metric
                  label="FTP"
                  value={`${num(profile?.ftp_watts, 1)} W`}
                  sub={metrics?.ftp_watts ? 'estimated from best 20 min' : null}
                />
                <Metric
                  label="Power to weight"
                  value={`${num(metrics?.power_to_weight, 2)} W/kg`}
                  sub={profile?.weight_kg != null ? `${num(profile.weight_kg, 1)} kg` : null}
                />
                <Metric label="Best 20 min" value={`${num(metrics?.best_20min_power)} W`} sub="last 90 days" />
              </div>
            </div>

            <div className="h-px bg-surface-light/40" />

            <div>
              <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">This week</p>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3">
                {stats.map((s) => (
                  <Metric key={s.label} label={s.label} value={s.value} sub={s.sub} />
                ))}
              </div>
            </div>

            <div className="h-px bg-surface-light/40" />
            <div className="flex min-h-[44px] items-center justify-between gap-2">
              <p className="text-[12px] text-muted">Plan your week in</p>
              <Link href="/fittrack/training" className="inline-flex items-center gap-1 text-[12px] font-medium text-accent">
                Training <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Panel className="p-4 sm:p-5">
          <PanelHead
            title="Recent rides"
            hint={rides.length ? `${rides.length} rides since ${formatShortDate(rides[rides.length - 1].date)}` : undefined}
          />
          <ul className="mt-3 divide-y divide-surface-light/30">
            {recent.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => onOpenRide(r.id)}
                  className="flex min-h-[52px] w-full items-center gap-3 py-2 text-left"
                >
                  <span className="w-[74px] shrink-0 text-[12px] text-muted">{formatDayDate(r.date)}</span>
                  <span className="w-[62px] shrink-0 text-[15px] font-semibold tabular-nums">
                    {num(r.distanceKm, 1)}
                    <span className="text-[12px] font-normal text-muted"> km</span>
                  </span>
                  <span className="hidden w-[54px] shrink-0 text-[12px] tabular-nums text-muted sm:block">
                    {formatDuration(r.movingSeconds)}
                  </span>
                  <span className="w-[54px] shrink-0 text-[12px] tabular-nums text-muted">
                    {num(r.tss)} <span className="text-[10px] uppercase">tss</span>
                  </span>
                  <span className="ml-auto shrink-0">
                    <TypeChip type={r.rideType} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-muted">
            Sorted newest first. {unclassified} of {rides.length} rides have no intensity classification yet.
          </p>
        </Panel>

        <Panel className="p-4 sm:p-5">
          <PanelHead title="12-week rhythm" hint="Rides per week, by type" />
          <div className="mt-4 flex h-[132px] items-end gap-1.5">
            {buckets.map((b, i) => (
              <div key={b.startISO} className="flex h-full flex-1 flex-col justify-end gap-[2px]">
                {b.total === 0 ? (
                  <div className="h-[3px] w-full rounded-sm bg-surface-light/40" />
                ) : (
                  Object.entries(b.byType).map(([type, count]) =>
                    Array.from({ length: count }).map((_, k) => (
                      <div
                        key={`${type}-${k}`}
                        className="w-full rounded-sm"
                        style={{
                          height: `${Math.max(6, (100 / maxBucket) * 0.72)}%`,
                          background: TYPE_COLOR[type] ?? TYPE_COLOR.unclassified,
                        }}
                        title={`${type} · week of ${b.label}`}
                      />
                    )),
                  )
                )}
                <span className="mt-1 text-center text-[10px] text-muted">{i % 3 === 0 ? b.label : ''}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between text-[12px] text-muted">
            <span>
              <strong className="font-semibold text-foreground">{buckets.reduce((a, b) => a + b.total, 0)}</strong> rides
              in 12 weeks · {buckets.filter((b) => b.total === 0).length} empty weeks
            </span>
            <Spark values={buckets.map((b) => b.total)} color="#22c55e" />
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-surface-light/30 pt-3 text-[12px]">
            {Object.entries(TYPE_COLOR)
              .map(([type, color]) => ({
                type,
                color,
                n: buckets.reduce((a, b) => a + (b.byType[type] ?? 0), 0),
              }))
              .filter((t) => t.n > 0)
              .map((t) => (
                <li key={t.type} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm" style={{ background: t.color }} />
                  <span className="text-muted">
                    {t.type === 'unclassified' ? 'Unclassified' : t.type} <span className="tabular-nums">{t.n}</span>
                  </span>
                </li>
              ))}
          </ul>
        </Panel>
      </div>

      <Panel className="p-4 sm:p-5" anchor="direction">
        <PanelHead title="Is the direction real?" hint="Weekly change in fitness, last 13 weeks" />
        <BarSeries values={rampValues} labels={rampLabels} height={132} color="#22c55e" maxTicks={6} />
        <p className="mt-1 text-[12px] text-muted">
          New fitness arrives at roughly +3 to +8 CTL per week; above that is a ramp you usually pay for later.
        </p>
      </Panel>
    </div>
  );
}
