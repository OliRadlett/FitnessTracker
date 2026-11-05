'use client';

/**
 * Power — what the engine is. One curve, one record table, the shape against the
 * norms the backend already computes, and the zone split. Depth (durability, CP
 * model, VO₂max, weather) sits behind one disclosure instead of five equal cards.
 */
import React from 'react';
import { LineSeries } from '@/components/charts/LineSeries';
import { StackBar } from '@/components/charts/StackBar';
import type {
  ChartData,
  CyclingProfile,
  DecouplingHistoryResponse,
  PowerCurveResponse,
  PowerModelResultsResponse,
  PowerZonesResponse,
  Vo2maxResponse,
  WeatherAnalysisResponse,
} from '@/lib/api';
import { durationRows, formatShortDate, R2_FLOOR, weatherRows, type DurationRow } from '@/lib/cycling/selectors';
import { Bar, Delta, Metric, Panel, PanelHead, num } from './CyclingUi';

const ZONE_COLORS = ['#64748b', '#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#a855f7', '#ec4899'];

export interface PowerModeProps {
  profile?: CyclingProfile;
  curveWindow?: PowerCurveResponse;
  curveYear?: PowerCurveResponse;
  percentile?: ChartData;
  zones?: PowerZonesResponse;
  decoupling?: DecouplingHistoryResponse;
  model?: PowerModelResultsResponse;
  vo2max?: Vo2maxResponse;
  weather?: WeatherAnalysisResponse;
  more: boolean;
  onToggleMore: () => void;
}

function shapeRows(percentile?: ChartData) {
  const you = percentile?.series?.find((s) => s.name.toLowerCase().startsWith('you'));
  const p50 = percentile?.series?.find((s) => s.name.startsWith('50th'));
  if (!you || !p50) return [];
  return (percentile?.labels ?? []).map((label, i) => ({
    label,
    you: you.data[i] ?? 0,
    ratio: p50.data[i] ? ((you.data[i] ?? 0) / (p50.data[i] as number)) * 100 : 0,
  }));
}

export function PowerMode({
  profile,
  curveWindow,
  curveYear,
  percentile,
  zones,
  decoupling,
  model,
  vo2max,
  weather,
  more,
  onToggleMore,
}: PowerModeProps) {
  const ftp = profile?.ftp_watts ?? curveWindow?.ftp_watts ?? null;
  const weightKg = profile?.weight_kg ?? null;
  const rows: DurationRow[] = React.useMemo(
    () => durationRows(curveWindow, curveYear, ftp, weightKg),
    [curveWindow, curveYear, ftp, weightKg],
  );

  const labels = rows.map((r) => r.label);
  const twenty = rows.find((r) => r.seconds === 1200);
  const fiveSec = rows.find((r) => r.seconds === 5);
  const longest = rows[rows.length - 1];
  const shape = shapeRows(percentile);
  const zoneList = zones?.zones ?? [];
  const zoneMinutes = zoneList.reduce((a, z) => a + z.time_seconds / 60, 0);
  const weather_ = weatherRows(weather);
  const cp = model?.critical_power?.cp ?? null;
  const wp = model?.critical_power?.w_prime ?? null;
  const pmax = model?.critical_power?.p_max ?? null;
  const r2 = model?.critical_power?.model_r_squared ?? null;
  const durability = [...(decoupling?.data ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1));
  const durabilityAvg = decoupling?.avg_decoupling_pct ?? (durability.length
    ? durability.reduce((s, d) => s + d.decoupling_pct, 0) / durability.length
    : null);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Panel className="p-4 sm:p-5">
          <PanelHead
            title="Power curve"
            hint={`${labels.length} durations · best effort in window`}
            right={
              <span className="flex items-center gap-3 text-[12px] text-muted">
                <span className="flex items-center gap-1">
                  <span className="h-[2px] w-3 bg-positive" /> 90 days
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 border-t border-dashed border-muted" /> 12 months
                </span>
              </span>
            }
          />
          <div className="mt-2">
            <LineSeries
              labels={labels}
              xAt={rows.map((r) => Math.log10(r.seconds))}
              series={[
                { name: '90d', color: '#22c55e', points: rows.map((r, i) => ({ x: i, y: r.bestWindow })) },
                {
                  name: '365d',
                  color: '#64748b',
                  dashed: true,
                  width: 1.5,
                  points: rows.map((r, i) => ({ x: i, y: r.bestLong })),
                },
              ]}
              height={430}
              yTitle="Power · W (durations spaced logarithmically)"
              refY={ftp != null ? { value: ftp, label: `FTP ${num(ftp, 1)}`, color: '#f59e0b' } : undefined}
              endLabels={false}
              maxTicks={7}
            />
          </div>
          <p className="mt-1 text-[12px] text-muted">
            5 s {num(fiveSec?.bestWindow)} W ({num(fiveSec?.wkg, 1)} W/kg) · 20 min {num(twenty?.bestWindow)} W (
            {num(twenty?.wkg, 2)} W/kg) · {longest?.label} {num(longest?.bestWindow)} W. The gap between the lines is
            the difference between this season and the last one.
          </p>
        </Panel>

        <Panel className="p-0">
          <div className="p-4 pb-1 sm:p-5 sm:pb-1">
            <PanelHead title="Records" hint="One row per duration, one measurement" />
          </div>
          <table className="w-full text-[12px]">
            <thead className="text-left text-[12px] uppercase tracking-[0.06em] text-muted">
              <tr>
                <th className="px-4 py-2 font-medium sm:px-5">Dur</th>
                <th className="px-2 py-2 text-right font-medium">90 d</th>
                <th className="px-2 py-2 text-right font-medium">W/kg</th>
                <th className="px-2 py-2 text-right font-medium">%FTP</th>
                <th className="px-4 py-2 text-right font-medium sm:px-5">vs 12mo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-light/30">
              {rows.map((r) => (
                <tr key={r.label} className={r.seconds === 1200 ? 'bg-surface-light/20' : ''}>
                  <td className="px-4 py-1.5 font-medium sm:px-5">{r.label}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{num(r.bestWindow)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-muted">{num(r.wkg, 2)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-muted">{num(r.pctFtp)}%</td>
                  <td className="px-4 py-1.5 text-right sm:px-5">
                    <Delta value={r.deltaPct} digits={0} suffix="%" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-2 text-[12px] text-muted sm:px-5">
            Both columns come from the same stream computation at two windows. Best-effort dates are not exposed by
            this endpoint yet — a production gap, not a design choice.
          </p>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="p-4 sm:p-5">
          <PanelHead title="Your shape vs trained norms" hint="You as % of the 50th percentile" />
          <ul className="mt-3 space-y-2">
            {shape.map((row) => (
              <li key={row.label} className="flex items-center gap-3">
                <span className="w-12 shrink-0 text-[12px] text-muted">{row.label}</span>
                <span className="w-11 shrink-0 text-[13px] font-medium tabular-nums">{row.you.toFixed(2)}</span>
                <Bar
                  pct={Math.min(100, row.ratio)}
                  color={row.ratio >= 100 ? '#22c55e' : row.ratio >= 75 ? '#3b82f6' : '#f59e0b'}
                />
                <span className="w-11 shrink-0 text-right text-[12px] tabular-nums text-muted">
                  {Math.round(row.ratio)}%
                </span>
              </li>
            ))}
          </ul>
          {shape.length > 0 && (
            <p className="mt-2 text-[12px] text-muted">
              You sit at {Math.round(shape[0].ratio)}% of the trained-male median over {shape[0].label} and{' '}
              {Math.round(shape[shape.length - 1].ratio)}% over {shape[shape.length - 1].label}; the widest gap is at{' '}
              {shape.reduce((a, b) => (a.ratio <= b.ratio ? a : b)).label} (
              {Math.round(Math.min(...shape.map((r) => r.ratio)))}%).
            </p>
          )}
        </Panel>

        <Panel className="p-4 sm:p-5">
          <PanelHead
            title="Where the time went"
            hint={`${Math.round(zoneMinutes)} min with power${ftp ? ` · FTP ${num(ftp, 1)} W` : ''}`}
          />
          <div className="mt-4">
            <StackBar
              segments={zoneList.map((z, i) => ({
                value: z.time_seconds / 60,
                color: ZONE_COLORS[i] ?? '#64748b',
                label: z.zone_name,
              }))}
              height={14}
            />
          </div>
          <ul className="mt-3 space-y-1.5">
            {zoneList.map((z, i) => (
              <li key={z.zone} className="flex items-center gap-2 text-[12px]">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: ZONE_COLORS[i] }} />
                <span className="w-5 shrink-0 text-muted">{z.zone}</span>
                <span className="w-[104px] shrink-0 whitespace-nowrap">{z.zone_name}</span>
                <span className="ml-auto shrink-0 tabular-nums text-muted">{num(z.percentage, 1)}%</span>
                <span className="w-14 shrink-0 text-right tabular-nums">{Math.round(z.time_seconds / 60)} min</span>
                <span className="hidden w-[80px] shrink-0 text-right tabular-nums text-muted/70 sm:block">
                  {Math.round(z.lower_bound_watts)}–{Math.round(z.upper_bound_watts)} W
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-muted">
            Time-in-zone across every ride with power. Each boundary is a percentage of FTP, so an FTP change
            re-labels all of it.
          </p>
        </Panel>
      </div>

      <Panel className="p-4 sm:p-5" anchor="more">
        <button
          onClick={onToggleMore}
          aria-expanded={more}
          className="flex min-h-[44px] w-full items-center justify-between gap-3 text-left"
        >
          <span>
            <span className="text-[13px] font-semibold">More analysis</span>
            <span className="ml-2 text-[12px] text-muted">durability · threshold model · VO₂max · weather</span>
          </span>
          <span className="text-[12px] text-muted">{more ? 'Hide' : 'Show'}</span>
        </button>

        {more && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-surface-light/40 p-3">
              <PanelHead title="Durability" hint="Power:HR decoupling, long rides" />
              {durability.length > 0 ? (
                <LineSeries
                  labels={[...durability].reverse().map((d) => formatShortDate(d.date))}
                  series={[
                    {
                      name: 'Decoupling',
                      color: '#60a5fa',
                      points: [...durability].reverse().map((d, i) => ({ x: i, y: d.decoupling_pct })),
                    },
                  ]}
                  height={130}
                  yTitle="%"
                  refY={{ value: 5, label: '5%', color: '#f59e0b' }}
                  maxTicks={4}
                />
              ) : (
                <p className="mt-2 text-[12px] text-muted">No long rides with power and HR yet.</p>
              )}
              <p className="mt-1 text-[12px] text-muted">
                Average {durabilityAvg != null ? durabilityAvg.toFixed(1) : '—'}% across {durability.length} long
                rides. Under 5% means the aerobic base holds; negative means the second half was the better half.
              </p>
            </div>

            <div className="rounded-lg border border-surface-light/40 p-3">
              <PanelHead title="Threshold model" hint="Morton 3-parameter" />
              <div className="mt-2 grid grid-cols-3 gap-2">
                <Metric label="CP" value={`${num(cp ?? profile?.critical_power)} W`} />
                <Metric label="W′" value={`${num((wp ?? profile?.w_prime ?? 0) / 1000, 1)} kJ`} />
                <Metric label="Pmax" value={`${num(pmax ?? profile?.p_max)} W`} />
              </div>
              <p className="mt-2 text-[12px] text-muted">
                Fitted R² {num(r2 ?? profile?.power_model_r_squared, 3)}. CP is the power you could hold indefinitely;
                W′ is the work above it you can spend.
              </p>
            </div>

            <div className="rounded-lg border border-surface-light/40 p-3">
              <PanelHead title="VO₂max estimate" hint={vo2max ? `${vo2max.all_estimates.length} methods` : undefined} />
              {vo2max ? (
                (() => {
                  const lo = vo2max.vo2max_ci_low ?? vo2max.vo2max * 0.85;
                  const hi = vo2max.vo2max_ci_high ?? vo2max.vo2max * 1.15;
                  const pos = ((vo2max.vo2max - lo) / (hi - lo)) * 100;
                  return (
                    <>
                      <div className="mt-2 flex items-baseline gap-2">
                        <span className="text-[26px] font-semibold leading-none tabular-nums">
                          {vo2max.vo2max.toFixed(1)}
                        </span>
                        <span className="text-[12px] text-muted">ml/kg/min</span>
                        <span className="ml-auto text-[12px] text-muted">{vo2max.classification}</span>
                      </div>
                      <div className="relative mt-3 h-2 rounded-full bg-surface-light/40">
                        <div
                          className="absolute top-[-3px] h-3.5 w-1 rounded-full bg-info"
                          style={{ left: `calc(${Math.max(0, Math.min(100, pos))}% - 2px)` }}
                        />
                      </div>
                      <p className="mt-1 flex justify-between text-[12px] tabular-nums text-muted">
                        <span>{lo.toFixed(0)}</span>
                        <span>95% interval</span>
                        <span>{hi.toFixed(0)}</span>
                      </p>
                      <p className="mt-1 text-[12px] text-muted">
                        The methods disagree ({vo2max.all_estimates.map((e) => e.vo2max.toFixed(0)).join(' / ')}), and
                        the interval spans {Math.round(hi - lo)} ml/kg/min. That is an order of magnitude, not a number
                        to chase.
                      </p>
                    </>
                  );
                })()
              ) : (
                <p className="mt-2 text-[12px] text-muted">
                  Needs per-second power from a maximal effort — no estimate yet.
                </p>
              )}
            </div>

            <div className="rounded-lg border border-surface-light/40 p-3">
              <PanelHead title="Weather" hint={`R² ≥ ${R2_FLOOR} to claim an effect`} />
              {weather_.length > 0 ? (
                <>
                  <ul className="mt-2 space-y-2">
                    {weather_.map((r) => (
                      <li key={r.label} className="flex items-baseline justify-between gap-2">
                        <span className="text-[12px] text-muted">{r.label}</span>
                        <span className="text-right">
                          <span
                            className={`text-[12px] tabular-nums ${r.supported ? 'font-medium text-foreground' : 'text-muted/70'}`}
                          >
                            {r.value}
                          </span>
                          <span className="ml-2 text-[12px] tabular-nums text-muted/80">{r.detail}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[12px] text-muted">
                    {weather_.filter((r) => r.supported).length === 0
                      ? `None of these ${weather_.length} coefficients clears the fit floor, so none is shown as a finding. The numbers are the fit, printed beside it.`
                      : `${weather_.filter((r) => r.supported).length} of ${weather_.length} coefficients clear the floor.`}
                  </p>
                </>
              ) : (
                <p className="mt-2 text-[12px] text-muted">
                  Needs rides with weather attached; nothing to fit yet.
                </p>
              )}
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
