import React from 'react';
import { ChevronDown } from 'lucide-react';
import { clean, fmtMonth, type DashboardFixture } from '@/lab/fixture';
import { Card, Chip, SectionLabel, Stat } from '@/lab/ui';
import { FormChart, HrvChart, WeeklyTssBars } from '@/lab/charts';
import { AnalysisCard } from '@/lab/analysis';

const RANGES = [
  { key: '7', label: '7D', days: 7 },
  { key: '30', label: '30D', days: 30 },
  { key: '90', label: '90D', days: 90 },
  { key: 'ytd', label: 'YTD', days: 300 },
] as const;

export function Trends({ f, now, openAnalysis = false }: { f: DashboardFixture; now: string; openAnalysis?: boolean }) {
  const [range, setRange] = React.useState<(typeof RANGES)[number]['key']>('90');
  const days = RANGES.find((r) => r.key === range)!.days;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12px] text-muted">
          {days >= 300 ? 'Year to date' : `Trailing ${days} days`} · one range governs every panel
        </p>
        <div className="inline-flex rounded-lg border border-surface-light bg-surface p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`min-h-[40px] rounded-md px-3 text-[12px] font-medium transition-colors ${
                range === r.key ? 'bg-accent text-background' : 'text-muted hover:text-foreground'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <Card className="p-5">
        <SectionLabel right={<span className="text-[11px] text-muted">{f.load.slice(-days).length} days · form {fmtRange(f.load.slice(-days).at(-1)?.tsb ?? 0)}</span>}>
          {formTakeaway(f.load.slice(-days))}
        </SectionLabel>
        <div className="mt-2">
          <FormChart points={f.load} days={days} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-[10px] text-muted">
          <span className="flex items-center gap-1">
            <span className="h-[2px] w-4 bg-accent" /> fitness (CTL)
          </span>
          <span className="flex items-center gap-1">
            <span className="h-[2px] w-4 bg-warning" /> fatigue (ATL)
          </span>
          <span className="flex items-center gap-1">
            <span className="h-[2px] w-4 bg-info" /> form (TSB)
          </span>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <SectionLabel right={<span className="text-[11px] text-muted">13 weeks</span>}>
            {weeklyTakeaway(f.weeklyTss.data)}
          </SectionLabel>
          <div className="mt-2">
            <WeeklyTssBars labels={f.weeklyTss.labels} values={f.weeklyTss.data} />
          </div>
          <p className="mt-1.5 text-[11px] text-muted">{f.weeklyTss.insight}</p>
        </Card>

        <Card className="p-5">
          <SectionLabel right={<span className="text-[11px] text-muted">60 days</span>}>
            Recovery — HRV behind the score
          </SectionLabel>
          <div className="mt-2">
            <HrvChart labels={f.hrvSeries.labels} values={f.hrvSeries.data} />
          </div>
          <p className="mt-1.5 text-[11px] text-muted">
            {f.readiness.hrv_ms?.toFixed(0)} ms today, resting HR {f.readiness.resting_hr} bpm.
          </p>
        </Card>
      </div>

      <Card className="p-5">
        <SectionLabel right={<span className="text-[11px] text-muted">target 25 Dec 2026</span>}>
          Goals — where the next PR comes from
        </SectionLabel>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          {f.goals.map((g, i) => {
            // Progress toward the target, not progress from the start line: 465/500
            // is the number an athlete reads, and delta-from-start is 0% for all
            // three goals in the real fixture — three invisible bars.
            const pct = Math.min(100, Math.round((g.current_value / (g.target_value || 1)) * 100));
            const label =
              g.metric === 'big3_total'
                ? 'Big-3 total'
                : `Est. 1RM · ${g.filter_json?.exercise ?? 'lift'}`;
            return (
              <div key={i}>
                <div className="flex items-baseline justify-between">
                  <span className="text-[12px] text-foreground/90">{label}</span>
                  <span className="text-[11px] tabular-nums text-muted">{pct}%</span>
                </div>
                <div className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-surface-light">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-1 text-[11px] tabular-nums text-muted">
                  {g.current_value} / {g.target_value} kg
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="p-5">
        <SectionLabel right={<Chip tone="neutral">weekly job</Chip>}>Analysis</SectionLabel>
        <div className="mt-3 space-y-2">
          <AnalysisCard
            title="Performance analysis"
            analysis={f.cyclingAnalysis}
            now={now}
            defaultOpen={openAnalysis}
          />
          <AnalysisCard title="Health analysis" analysis={f.healthAnalysis} now={now} />
        </div>
        <div className="mt-4 border-t border-surface-light/50 pt-3">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-muted">
            <ChevronDown size={12} /> Weakness register
          </div>
          <ul className="mt-2 space-y-1.5">
            {f.deficiency.weaknesses.map((w, i) => (
              <li key={i} className="flex items-start gap-2 text-[12px]">
                <Chip tone={w.severity === 'high' ? 'caution' : 'neutral'}>{w.severity}</Chip>
                <span className="text-foreground/85">{clean(w.detail)}</span>
              </li>
            ))}
          </ul>
        </div>
      </Card>
    </div>
  );
}

function fmtRange(tsb: number): string {
  return `${tsb >= 0 ? '+' : '−'}${Math.abs(tsb).toFixed(1)}`;
}

/** The sentence a chart's title should carry: what the data says, not what it is. */
export function weeklyTakeaway(values: number[]): string {
  if (values.length < 2) return 'Weekly load';
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  const last = values[values.length - 1];
  const pct = avg > 0 ? Math.round(((last - avg) / avg) * 100) : 0;
  const dir = pct >= 0 ? 'above' : 'below';
  return `Weekly load: ${Math.round(last)} TSS — ${Math.abs(pct)}% ${dir} the ${values.length}-week average`;
}

export function formTakeaway(points: { ctl: number }[]): string {
  if (points.length < 2) return 'Form';
  const first = points[0].ctl;
  const last = points[points.length - 1].ctl;
  const pct = first > 0 ? Math.round(((last - first) / first) * 100) : 0;
  return pct === 0
    ? 'Form — fitness flat over the window'
    : `Form — fitness ${pct > 0 ? 'up' : 'down'} ${Math.abs(pct)}% across the window`;
}

export function History({ f }: { f: DashboardFixture }) {
  const rows = f.months;
  const y = f.yearly;
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <SectionLabel right={<span className="text-[11px] text-muted">{y.year}</span>}>
          Year to date
        </SectionLabel>
        <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Stat label="Activities" value={y.total_activities.toString()} sub={`${y.year_over_year.activities_delta} vs last year`} />
          <Stat label="Distance" value={Math.round(y.total_distance_m / 1000).toLocaleString()} unit="km" />
          <Stat label="Load" value={Math.round(y.total_tss).toLocaleString()} unit="TSS" />
          <Stat label="Lifting" value={y.total_lifting_sessions.toString()} unit="sessions" sub={`${Math.round(y.total_lifting_volume_kg / 1000)} t volume`} />
          <Stat label="PRs" value={y.highlights.total_prs.toString()} sub={`+${y.year_over_year.prs_delta} vs last year`} />
        </div>
      </Card>

      <Card className="p-5">
        <SectionLabel right={<span className="text-[11px] text-muted">12 months</span>}>
          By month
        </SectionLabel>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-[12px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-[0.1em] text-muted">
                <th className="border-b border-surface-light/60 py-1.5 text-left font-medium">Month</th>
                <th className="border-b border-surface-light/60 py-1.5 text-right font-medium">Load</th>
                <th className="border-b border-surface-light/60 py-1.5 text-right font-medium">Distance</th>
                <th className="border-b border-surface-light/60 py-1.5 text-right font-medium">Lifting</th>
                <th className="border-b border-surface-light/60 py-1.5 text-right font-medium">Sessions</th>
                <th className="border-b border-surface-light/60 py-1.5 text-right font-medium">PRs</th>
                <th className="border-b border-surface-light/60 py-1.5 text-right font-medium">Recovery</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {rows.map((m) => (
                <tr key={m.month} className="text-foreground/85">
                  <td className="border-b border-surface-light/30 py-1.5 text-left">
                    {fmtMonth(m.month)} <span className="text-[10px] text-muted">{m.month.slice(2, 4)}</span>
                  </td>
                  <td className="border-b border-surface-light/30 py-1.5 text-right">{Math.round(m.total_tss)}</td>
                  <td className="border-b border-surface-light/30 py-1.5 text-right">
                    {m.total_distance_meters > 0 ? `${Math.round(m.total_distance_meters / 1000)} km` : '—'}
                  </td>
                  <td className="border-b border-surface-light/30 py-1.5 text-right">
                    {m.lifting_volume_kg > 0 ? `${(m.lifting_volume_kg / 1000).toFixed(1)} t` : '—'}
                  </td>
                  <td className="border-b border-surface-light/30 py-1.5 text-right">{m.cardio_sessions + m.lifting_sessions}</td>
                  <td className="border-b border-surface-light/30 py-1.5 text-right">
                    {m.pr_count > 0 ? m.pr_count : '—'}
                  </td>
                  <td className="border-b border-surface-light/30 py-1.5 text-right text-muted">
                    {m.avg_recovery !== null ? `${Math.round(m.avg_recovery)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-5">
        <SectionLabel right={<span className="text-[11px] text-muted">top 6</span>}>
          Personal records
        </SectionLabel>
        <ul className="mt-2 divide-y divide-surface-light/30">
          {y.highlights.pr_highlights.slice(0, 6).map((p, i) => (
            <li key={i} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1 truncate text-[13px]">{clean(p.exercise_name)}</span>
              <span className="text-[11px] text-muted">{p.achieved_date}</span>
              <span className="w-[52px] text-right text-[12px] tabular-nums text-accent">
                +{p.improvement_pct}%
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
