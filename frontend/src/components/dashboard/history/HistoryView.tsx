'use client';

/**
 * History — the record as recorded.
 *
 * No derived verdicts, no charts: the 12-month table and the PR list. This zone
 * exists because the old Week tab contained the whole year, twice, as cards.
 */

import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { SectionLabel } from '@/components/ui/SectionLabel';
import type { DashboardPageData } from '@/lib/dashboard/useDashboardPage';

function monthLabel(ym: string): string {
  const d = new Date(`${ym}-01T12:00:00Z`);
  return d.toLocaleDateString('en-GB', { month: 'short' });
}

export function HistoryView({ page }: { page: DashboardPageData }) {
  const months = page.history.months.data ?? [];
  const yearly = page.history.yearly.data;

  return (
    <div className="space-y-4">
      <PageHeader title="History" subtitle="The record, as recorded — no derived verdicts." />

      <Card className="p-5">
        <SectionLabel action={<span className="text-[11px] text-muted">{yearly?.year ?? ''}</span>}>
          Year to date
        </SectionLabel>
        {page.history.yearly.state === 'loading' ? (
          <p className="mt-2 text-[12px] text-muted">Loading the year…</p>
        ) : !yearly ? (
          <p className="mt-2 text-[12px] text-muted">
            No yearly summary yet. It is computed from recorded activities and sessions.
          </p>
        ) : (
          <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-5">
            <Number label="Activities" value={String(yearly.total_activities)} />
            <Number label="Distance" value={`${Math.round(yearly.total_distance_m / 1000).toLocaleString()} km`} />
            <Number label="Load" value={`${Math.round(yearly.total_tss).toLocaleString()} TSS`} />
            <Number
              label="Lifting"
              value={`${yearly.total_lifting_sessions} sessions`}
              hint={`${Math.round(yearly.total_lifting_volume_kg / 1000)} t volume`}
            />
            <Number label="PRs" value={String(yearly.highlights?.total_prs ?? 0)} />
          </dl>
        )}
      </Card>

      <Card className="p-5">
        <SectionLabel action={<span className="text-[11px] text-muted">12 months</span>}>By month</SectionLabel>
        {months.length === 0 ? (
          <p className="mt-2 text-[12px] text-muted">
            No months recorded yet. This table fills in as activities land.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-[12px]">
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
                {months.map((m) => (
                  <tr key={m.month} className="text-foreground/85">
                    <td className="border-b border-surface-light/30 py-1.5 text-left">
                      {monthLabel(m.month)}{' '}
                      <span className="text-[10px] text-muted">{m.month.slice(2, 4)}</span>
                    </td>
                    <td className="border-b border-surface-light/30 py-1.5 text-right">
                      {Math.round(m.total_tss)}
                    </td>
                    <td className="border-b border-surface-light/30 py-1.5 text-right">
                      {m.total_distance_meters > 0
                        ? `${Math.round(m.total_distance_meters / 1000)} km`
                        : '—'}
                    </td>
                    <td className="border-b border-surface-light/30 py-1.5 text-right">
                      {m.lifting_volume_kg > 0 ? `${(m.lifting_volume_kg / 1000).toFixed(1)} t` : '—'}
                    </td>
                    <td className="border-b border-surface-light/30 py-1.5 text-right">
                      {m.cardio_sessions + m.lifting_sessions}
                    </td>
                    <td className="border-b border-surface-light/30 py-1.5 text-right">
                      {m.pr_count > 0 ? m.pr_count : '—'}
                    </td>
                    <td className="border-b border-surface-light/30 py-1.5 text-right text-muted">
                      {m.avg_recovery !== null && m.avg_recovery !== undefined
                        ? `${Math.round(m.avg_recovery)}%`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <SectionLabel action={<span className="text-[11px] text-muted">top 6</span>}>
          Personal records
        </SectionLabel>
        {(yearly?.highlights?.pr_highlights?.length ?? 0) === 0 ? (
          <p className="mt-2 text-[12px] text-muted">No personal records this year yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-surface-light/30">
            {yearly!.highlights.pr_highlights.slice(0, 6).map((p, i) => (
              <li key={`${p.exercise_name}-${i}`} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1 truncate text-[13px]">{p.exercise_name}</span>
                <span className="text-[11px] text-muted">{p.achieved_date}</span>
                <span className="w-[52px] text-right text-[12px] tabular-nums text-accent">
                  +{p.improvement_pct}%
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Number({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.1em] text-muted">{label}</dt>
      <dd className="mt-0.5 text-[17px] font-semibold tabular-nums">{value}</dd>
      {hint && <dd className="text-[11px] text-muted">{hint}</dd>}
    </div>
  );
}
