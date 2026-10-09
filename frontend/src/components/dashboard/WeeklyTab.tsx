'use client';

import React from 'react';
import Link from 'next/link';
import type {
  DashboardSummary,
  ChartData,
  Activity,
  LiftingSession,
  ReadinessResponse,
  RespiratoryRateResponse,
  WhoopWeeklySummary,
  HealthAnalysisResult,
  TrainingStreaks,
  Goal,
  Event,
  LlmAnalysis,
  DeficiencyResponse,
  CrossDomainInsightsResponse,
  WeeklyReport,
} from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Chart, ChartBody } from '@/components/charts/Chart';
import { ErrorState } from '@/components/ui/ErrorState';
import { useQuery } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import { timeRangeDays, timeRangeWeeks, useTimeRange } from '@/lib/time-range';
import { WeekNavigator, mondayOfOffset, toDateStr } from './PeriodNav';
import { ReadinessIndicator } from '@/components/ui/ReadinessIndicator';
import { SkeletonMetric } from '@/components/ui/Skeleton';
import { LlmAnalysisCard } from '@/components/cycling/LlmAnalysisCard';
import { HealthAiAnalysisCard } from '@/components/health/HealthAiAnalysisCard';
import { EventAiAnalysisCard } from '@/components/training/EventAiAnalysisCard';
import { MetricCard } from '@/components/ui/MetricCard';
import { WhoopWeeklyCard } from '@/components/health/WhoopWeeklyCard';
import { RespiratoryRateCard } from '@/components/health/RespiratoryRateCard';
import { ActivityRow, SessionRow, ListSkeleton } from '@/components/dashboard/helpers';
import { HealthAlertsSection } from '@/components/health/HealthAlertsSection';
import { GoalsSection } from './GoalsSection';
import { DeficiencyCard } from '@/components/ui/DeficiencyCard';
import { CrossDomainInsightsCard } from '@/components/dashboard/CrossDomainInsightsCard';
import { MonthlySummarySection, YearlySummarySection } from './PeriodSummaries';
import type { PeriodSummaryProps } from './PeriodSummaries';

interface WeeklyTabProps {
  summary: DashboardSummary | undefined;
  summaryLoading: boolean;
  readiness: ReadinessResponse | undefined;
  hasReadiness: boolean;
  respiratoryRate: RespiratoryRateResponse | undefined;
  whoopWeekly: WhoopWeeklySummary | undefined;
  hasWhoop: boolean;
  activities: Activity[] | undefined;
  activitiesLoading: boolean;
  activitiesError?: boolean;
  onRetryActivities?: () => void;
  sessions: LiftingSession[] | undefined;
  sessionsLoading: boolean;
  sessionsError?: boolean;
  onRetrySessions?: () => void;
  recentSessions: LiftingSession[];
  streaks: TrainingStreaks | undefined;
  goals: Goal[] | undefined;
  deficiency: DeficiencyResponse | undefined;
  deficiencyLoading?: boolean;
  // BUG-040: the six period-summary props travel as one object.
  period: PeriodSummaryProps;
  upcomingEvents: Event[] | undefined;
  llmAnalysis: LlmAnalysis | null | undefined;
  llmLoading: boolean;
  onRefreshLlm: () => void;
  isRefreshingLlm: boolean;
  analysisResults: HealthAnalysisResult[] | null;
  isAnalyzing: boolean;
  onAnalyze: () => void;
  onDownloadReport: (apiPath: string, filename: string) => void;
}

export function WeeklyTab({
  summary,
  summaryLoading,
  readiness,
  hasReadiness,
  respiratoryRate,
  whoopWeekly,
  hasWhoop,
  activities,
  activitiesLoading,
  activitiesError,
  onRetryActivities,
  sessionsLoading,
  sessionsError,
  onRetrySessions,
  recentSessions,
  streaks,
  goals,
  deficiency,
  deficiencyLoading,
  period,
  upcomingEvents,
  llmAnalysis,
  llmLoading,
  onRefreshLlm,
  isRefreshingLlm,
  analysisResults,
  isAnalyzing,
  onAnalyze,
  onDownloadReport,
}: WeeklyTabProps) {
  const { authFetch, token } = useAuthFetch();

  /* ── Shared REVIEW time-range (ui-redesign-v2 §2.1): one picker drives every
     dashboard chart together. Day/week spans are clamped to the backend caps
     (days ≤ 365, weeks ≤ 52) inside timeRangeDays / timeRangeWeeks. ─────── */
  const { start: rangeStart, end: rangeEnd, preset: rangePreset } = useTimeRange();
  const chartDays = timeRangeDays(rangeStart, rangeEnd);
  const chartWeeks = timeRangeWeeks(rangeStart, rangeEnd);

  /* ── Previous-period navigation (Walkthrough: history is unreachable
     without it). weeksBack matches the backend `?weeks_back=` param
     (0 = current week … 12); week bounds are Monday-aligned like the backend
     `_week_bounds` (see PeriodNav). ─────────────────────────────────────── */
  const [weeksBack, setWeeksBack] = React.useState(0);
  const viewedMondayStr = toDateStr(mondayOfOffset(weeksBack));

  const {
    data: weeklyReport,
    isLoading: weeklyReportLoading,
    isError: weeklyReportError,
  } = useQuery<WeeklyReport>({
    queryKey: ['weekly-report', weeksBack],
    queryFn: () => authFetch<WeeklyReport>(`/api/v1/dashboard/weekly-report?weeks_back=${weeksBack}`),
    staleTime: 300_000,
    refetchOnWindowFocus: true,
    enabled: !!token,
  });

  const { data: weeklyTss, isLoading: tssLoading } = useQuery<ChartData>({
    queryKey: ['chart-weekly-tss', chartWeeks],
    queryFn: () => authFetch<ChartData>(`/api/v1/charts/weekly_tss?weeks=${chartWeeks}`),
    staleTime: 300_000,
    refetchOnWindowFocus: true,
    enabled: !!token,
  });

  const { data: strainVsRecovery } = useQuery<ChartData>({
    queryKey: ['chart-strain-vs-recovery', chartDays],
    queryFn: () => authFetch<ChartData>(`/api/v1/charts/strain_vs_recovery?days=${chartDays}`),
    staleTime: 300_000,
    refetchOnWindowFocus: true,
    enabled: !!token,
  });

  const { data: hrvChart, isLoading: hrvLoading } = useQuery<ChartData>({
    queryKey: ['chart-hrv-trend-detailed', chartDays],
    queryFn: () => authFetch<ChartData>(`/api/v1/charts/hrv_trend_detailed?days=${chartDays}`),
    staleTime: 300_000,
    enabled: !!token,
  });

  const { data: heatmapChart, isLoading: heatmapLoading } = useQuery<ChartData>({
    queryKey: ['chart-consistency-heatmap', chartDays],
    queryFn: () => authFetch<ChartData>(`/api/v1/charts/consistency_heatmap?days=${chartDays}`),
    staleTime: 300_000,
    enabled: !!token,
  });

  const { data: crossDomainInsights, isLoading: crossDomainLoading } = useQuery<CrossDomainInsightsResponse>({
    queryKey: ['cross-domain-insights'],
    queryFn: () => authFetch<CrossDomainInsightsResponse>('/api/v1/cross-domain'),
    staleTime: 600_000,
    enabled: !!token,
  });

  return (
    <div className="space-y-8">
      {/* Rest-day verdict lives once in the page-level VerdictCard slot above
          the tabs (ui-redesign-v2 §1) — no second banner here. */}

      {/* ── Upcoming Events Banner ──────────────────────────────────────────── */}
      {upcomingEvents && upcomingEvents.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {upcomingEvents.slice(0, 3).map(evt => (
            <Link
              key={evt.id}
              href="/training"
              className={`rounded-xl p-4 border block transition-colors hover:border-accent/40 ${
                evt.is_in_taper
                  ? 'bg-purple-900/20 border-purple-500/30'
                  : 'bg-surface border-surface-light/50'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-xl">{evt.event_type === 'race' ? '🏁' : evt.event_type === 'ride' ? '🚴' : evt.event_type === 'lift' ? '🏋️' : '📌'}</span>
                <div>
                  <p className="text-foreground font-medium text-sm">{evt.name}</p>
                  <p className="text-xs text-muted">{evt.event_date}</p>
                </div>
              </div>
              <p className="text-sm mt-2">
                {evt.days_until === 0 ? (
                  <span className="text-accent font-bold">🎯 Today!</span>
                ) : (
                  <span className="text-foreground">🎯 <strong>{evt.days_until}</strong> days away</span>
                )}
              </p>
              {evt.is_in_taper && (
                <p className="text-xs text-purple-300 mt-1">📉 Taper phase — reduce load</p>
              )}
              {evt.days_until_taper !== undefined && evt.days_until_taper > 0 && evt.days_until_taper <= 14 && (
                <p className="text-xs text-muted mt-1">Taper starts in {evt.days_until_taper} days</p>
              )}
            </Link>
          ))}
        </div>
      )}

      {/* ── Event AI Analysis (for nearest upcoming event) ────────────────────── */}
      {upcomingEvents && upcomingEvents.length > 0 && upcomingEvents[0].days_until <= 56 && (
        <EventAiAnalysisCard eventId={upcomingEvents[0].id} />
      )}

      {/* ── Week history (Phase 2: prev/next week navigation) ───────────────
          Backend-backed look-back via GET /dashboard/weekly-report?weeks_back=N
          (Monday-aligned bounds). The grid below stays put (data maximalism);
          this strip is the per-week detail the dashboard could never reach. */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="text-sm font-medium text-muted uppercase tracking-wider">Week History</h2>
          <WeekNavigator weeksBack={weeksBack} onChange={setWeeksBack} />
        </div>
        {weeklyReportLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonMetric key={i} />)}
          </div>
        ) : weeklyReportError ? (
          <ErrorState variant="inline" show message="This week's report failed to load." />
        ) : weeklyReport ? (
          (weeklyReport.lifting_sessions + weeklyReport.cardio_sessions) === 0 ? (
            <Card>
              <div className="text-center py-6">
                <p className="text-3xl mb-2">📭</p>
                <p className="text-muted text-sm tabular-nums">
                  No training logged {weeksBack === 0 ? 'this week' : `week of ${weeklyReport.week_start}`} yet
                </p>
                <p className="text-muted text-xs mt-1">Pick another week above, or log a session to start it.</p>
              </div>
            </Card>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <MetricCard
                label="TSS"
                value={weeklyReport.total_tss.toFixed(0)}
                subtitle={`${weeklyReport.cardio_sessions} cardio sessions`}
                color="text-blue-400"
                icon="⚡"
                tooltip="Training Stress Score for the viewed week (Monday–Sunday). 100 TSS = 1 hour at FTP."
              />
              <MetricCard
                label="Volume"
                value={`${weeklyReport.lifting_volume_kg.toLocaleString()} kg`}
                subtitle={`${weeklyReport.lifting_sessions} lifting sessions`}
                color="text-purple-400"
                icon="🏋️"
                tooltip="Lifting volume (sets × reps × weight) for the viewed week."
              />
              <MetricCard
                label="Recovery"
                value={weeklyReport.avg_recovery != null ? `${weeklyReport.avg_recovery.toFixed(0)}%` : '—'}
                subtitle={weeklyReport.avg_hrv_ms != null ? `HRV ${weeklyReport.avg_hrv_ms.toFixed(0)} ms` : 'Weekly average'}
                color={(weeklyReport.avg_recovery ?? 0) >= 70 ? 'text-positive' : 'text-warning'}
                icon="❤️"
              />
              <MetricCard
                label="Sleep"
                value={weeklyReport.avg_sleep_hours != null ? `${weeklyReport.avg_sleep_hours.toFixed(1)}h` : '—'}
                subtitle="Nightly average"
                color="text-positive"
                icon="😴"
              />
              <MetricCard
                label="PRs"
                value={weeklyReport.new_prs}
                subtitle="New records"
                color={weeklyReport.new_prs > 0 ? 'text-yellow-400' : 'text-muted'}
                icon="🏆"
              />
              <MetricCard
                label="Week"
                value={`${weeklyReport.lifting_sessions + weeklyReport.cardio_sessions} sessions`}
                subtitle={`${weeklyReport.week_start} → ${weeklyReport.week_end}`}
                color="text-muted"
                icon="📅"
              />
            </div>
          )
        ) : null}
      </div>

      {/* ── Status Row: Readiness + Respiratory + Key Vitals ─────────────────── */}
      {hasReadiness && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <ReadinessIndicator
            recoveryScore={readiness!.recovery_score ?? undefined}
            readiness={readiness!.readiness}
            hrvMs={readiness!.hrv_ms ?? undefined}
            restingHr={readiness!.resting_hr ?? undefined}
            message={readiness!.message}
          />
          {respiratoryRate ? (
            <RespiratoryRateCard data={respiratoryRate} />
          ) : (
            <div className="bg-surface rounded-xl border border-surface-light/50 p-4 flex items-center justify-center text-muted text-sm">
              No respiratory data
            </div>
          )}
          <MetricCard
            label="Daily Strain"
            value={summary?.latest_strain?.toFixed(1) ?? '—'}
            subtitle="Whoop strain (0-21)"
            color={
              (summary?.latest_strain ?? 0) >= 14 ? 'text-warning'
              : (summary?.latest_strain ?? 0) >= 10 ? 'text-yellow-400'
              : 'text-positive'
            }
            icon="💪"
            tooltip="Whoop Strain (0-21) measures cardiovascular load. 0-9: low, 10-13: moderate, 14-17: high, 18+: all-out. Based on time in HR zones."
          />
          <MetricCard
            label="Active Alerts"
            value={summary?.active_alerts_count ?? 0}
            subtitle="Health warnings"
            color={(summary?.active_alerts_count ?? 0) > 0 ? 'text-warning' : 'text-positive'}
            icon="🔔"
            tooltip="Health alerts triggered by declining HRV, elevated respiratory rate, poor sleep, or other anomalies."
          />
        </div>
      )}

      {/* ── Weekly KPI Metrics ───────────────────────────────────────────────── */}
      <div>
        <h2 className="text-sm font-medium text-muted uppercase tracking-wider mb-3">This Week</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {summaryLoading ? (
            Array.from({ length: 5 }).map((_, i) => <SkeletonMetric key={i} />)
          ) : (
            <>
              <MetricCard
                label="Volume"
                value={summary ? `${summary.weekly_volume_kg.toLocaleString()} kg` : '—'}
                subtitle={`${summary?.weekly_sessions ?? 0} lifting sessions`}
                color="text-accent"
                icon="🏋️"
                tooltip="Total lifting volume (sets × reps × weight) this week. Track progressive overload by comparing week-to-week."
              />
              <MetricCard
                label="Distance"
                value={summary ? `${(summary.weekly_distance_meters / 1000).toFixed(1)} km` : '—'}
                subtitle="Cycling, running, etc."
                color="text-positive"
                icon="🚴"
                tooltip="Total cardio distance this week across all activities."
              />
              <MetricCard
                label="TSS"
                value={summary?.weekly_tss?.toFixed(0) ?? '—'}
                subtitle="Training Stress Score"
                color="text-blue-400"
                icon="⚡"
                tooltip="Weekly Training Stress Score — composite measure of workout difficulty. 100 TSS = 1 hour at FTP. Aim for consistent weekly TSS with periodic recovery weeks."
              />
              {!hasReadiness && (
                <MetricCard
                  label="Recovery"
                  value={summary?.latest_recovery?.toFixed(1) ?? '—'}
                  subtitle={summary?.latest_hrv_ms ? `HRV: ${summary.latest_hrv_ms.toFixed(0)}ms` : 'No data'}
                  color={(summary?.latest_recovery ?? 0) >= 70 ? 'text-positive' : 'text-warning'}
                  icon="❤️"
                  tooltip="Whoop recovery score (0-100%). Green (70%+): ready to train hard. Yellow (50-69%): moderate. Red (<50%): consider rest."
                />
              )}
              <MetricCard
                label="Strain"
                value={summary?.latest_strain?.toFixed(1) ?? '—'}
                subtitle="Whoop strain (0-21)"
                color={
                  (summary?.latest_strain ?? 0) >= 14 ? 'text-warning'
                  : (summary?.latest_strain ?? 0) >= 10 ? 'text-yellow-400'
                  : 'text-positive'
                }
                icon="💪"
                tooltip="Whoop Strain (0-21) measures cardiovascular load. 0-9: low, 10-13: moderate, 14-17: high, 18+: all-out."
              />
              <MetricCard
                label="Alerts"
                value={summary?.active_alerts_count ?? 0}
                subtitle="Health warnings"
                color={(summary?.active_alerts_count ?? 0) > 0 ? 'text-warning' : 'text-muted'}
                icon="🔔"
                tooltip="Health alerts triggered by declining HRV, elevated respiratory rate, poor sleep, or other anomalies."
              />
            </>
          )}
        </div>
      </div>

      {/* ── Health & Wellness ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <HealthAlertsSection
          analysisResults={analysisResults}
          isAnalyzing={isAnalyzing}
          onAnalyze={onAnalyze}
        />
        {hasWhoop ? (
          <WhoopWeeklyCard data={whoopWeekly!} />
        ) : (
          <Link href="/settings" className="block">
            <Card className="flex items-center justify-center text-muted transition-colors hover:border-accent/40">
              <div className="text-center py-8">
                <p className="text-3xl mb-2">🩺</p>
                <p className="text-sm">Connect Whoop for weekly health insights</p>
              </div>
            </Card>
          </Link>
        )}
      </div>

      {/* ── AI Health Analysis ─────────────────────────────────────────────────── */}
      <HealthAiAnalysisCard />

      {/* ── AI Performance Analysis ─────────────────────────────────────────── */}
      <LlmAnalysisCard
        analysis={llmAnalysis ?? null}
        isLoading={llmLoading}
        onRefresh={onRefreshLlm}
        isRefreshing={isRefreshingLlm}
      />

      {/* ── Training Charts (shared range — see caption) ───────────────────── */}
      <div className="space-y-6">
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
            <h2 className="text-sm font-medium text-muted uppercase tracking-wider">Training Load</h2>
            <span className="text-xs text-muted tabular-nums">Shared range · {rangePreset}</span>
          </div>
          <Card>
            <ChartBody
              isLoading={tssLoading}
              data={weeklyTss}
              emptyMessage="No TSS data available"
              height={300}
            />
          </Card>
        </div>

        {strainVsRecovery && strainVsRecovery.labels.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Strain vs Next-Day Recovery</CardTitle>
            </CardHeader>
            <Chart data={strainVsRecovery} height={300} />
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>HRV Trend</CardTitle>
            </CardHeader>
            <ChartBody
              isLoading={hrvLoading}
              data={hrvChart}
              emptyMessage="No HRV data available. Sync Whoop to populate."
              height={260}
            />
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Training Consistency</CardTitle>
            </CardHeader>
            <ChartBody
              isLoading={heatmapLoading}
              data={heatmapChart}
              emptyMessage="No training data available yet"
              height={260}
            />
          </Card>
        </div>
      </div>

      {/* ── Recent Activity ──────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-sm font-medium text-muted uppercase tracking-wider mb-3">Recent Activity</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between w-full">
                <CardTitle>Activities</CardTitle>
                <span className="text-xs text-muted">Last 5</span>
              </div>
            </CardHeader>
            {activitiesLoading ? (
              <ListSkeleton />
            ) : activitiesError ? (
              <ErrorState
                title="Couldn't load activities"
                message="Check your connection and try again."
                onRetry={onRetryActivities}
              />
            ) : activities && activities.length > 0 ? (
              <div className="space-y-2">
                {activities.map((activity) => (
                  <ActivityRow key={activity.id} activity={activity} />
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-3xl mb-2" aria-hidden="true">🏃</p>
                <p className="text-muted text-sm">No recent activities</p>
                <p className="text-muted text-xs mt-1">
                  <a href="/settings" className="text-accent hover:text-accent-hover">Connect Strava</a> to start syncing
                </p>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between w-full">
                <CardTitle>Lifting Sessions</CardTitle>
                <span className="text-xs text-muted">Last 5</span>
              </div>
            </CardHeader>
            {sessionsLoading ? (
              <ListSkeleton />
            ) : sessionsError ? (
              <ErrorState
                title="Couldn't load lifting sessions"
                message="Check your connection and try again."
                onRetry={onRetrySessions}
              />
            ) : recentSessions.length > 0 ? (
              <div className="space-y-2">
                {recentSessions.map((session) => (
                  <SessionRow key={session.id} session={session} />
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-3xl mb-2" aria-hidden="true">🏋️</p>
                <p className="text-muted text-sm">No lifting sessions yet</p>
                <a href="/lifting" className="text-accent hover:text-accent-hover text-xs mt-1 inline-block">Create your first session</a>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* ── Training Streaks ─────────────────────────────────────────────── */}
      {streaks && (
        <div>
          <h2 className="text-sm font-medium text-muted uppercase tracking-wider mb-3">Training Streaks</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard
              label="Current Streak"
              value={streaks.current_streak_days > 0 ? `${streaks.current_streak_days} days` : '—'}
              subtitle={streaks.current_streak_days > 0 ? 'Keep it going!' : 'Start training today'}
              color="text-orange-400"
              icon="🔥"
              tooltip="Consecutive days with at least one training session. Consistency is key to long-term progress."
            />
            <MetricCard
              label="Longest Streak"
              value={streaks.longest_streak_days > 0 ? `${streaks.longest_streak_days} days` : '—'}
              subtitle="All-time record"
              color="text-yellow-400"
              icon="🏆"
              tooltip="Your all-time record for consecutive training days."
            />
            <MetricCard
              label="Weekly Consistency"
              value={streaks.weekly_consistency_pct > 0 ? `${streaks.weekly_consistency_pct}%` : '—'}
              subtitle="Weeks with ≥3 sessions"
              color={
                streaks.weekly_consistency_pct >= 75 ? 'text-positive'
                : streaks.weekly_consistency_pct >= 50 ? 'text-yellow-400'
                : 'text-warning'
              }
              icon="📊"
              tooltip="Percentage of weeks where you completed 3+ training sessions. 75%+ is excellent consistency."
            />
            <MetricCard
              label="This Month"
              value={
                streaks.monthly_sessions.length > 0
                  ? `${streaks.monthly_sessions[streaks.monthly_sessions.length - 1].sessions}`
                  : '0'
              }
              subtitle="Total sessions"
              color="text-blue-400"
              icon="📅"
              tooltip="Total training sessions completed this month across all activities."
            />
          </div>

          {/* Monthly session bars */}
          {streaks.monthly_sessions.length > 0 && (
            <div className="mt-4 flex items-end gap-2 h-20">
              {streaks.monthly_sessions.map((m) => {
                const maxSessions = Math.max(...streaks.monthly_sessions.map((s) => s.sessions), 1);
                const heightPct = (m.sessions / maxSessions) * 100;
                return (
                  <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[10px] text-muted font-medium">{m.sessions}</span>
                    <div className="w-full bg-surface-light/40 rounded-t" style={{ height: `${Math.max(heightPct, 4)}%` }}>
                      <div className="w-full h-full bg-accent/60 rounded-t" />
                    </div>
                    <span className="text-[10px] text-muted">{m.month.slice(5)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Goals ───────────────────────────────────────────────────────── */}
      <GoalsSection goals={goals} />

      {/* ── Weakness / Deficiency Analysis ───────────────────────────────── */}
      <DeficiencyCard data={deficiency} isLoading={deficiencyLoading} />

      {/* ── Cross-Domain Insights ──────────────────────────────────────────── */}
      <CrossDomainInsightsCard
        crossDomainInsights={crossDomainInsights}
        isLoading={crossDomainLoading}
      />

      {/* ── Monthly Summary ──────────────────────────────────────────────── */}
      <MonthlySummarySection monthlySummary={period.monthlySummary} />

      {/* ── Download Reports ─────────────────────────────────────────────── */}
      <div>
        <h2 className="text-sm font-medium text-muted uppercase tracking-wider mb-3">Download Reports</h2>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => onDownloadReport(
              `/api/v1/export/weekly-report/${viewedMondayStr}`,
              `fittrack_weekly_${viewedMondayStr}.pdf`,
            )}
            className="px-4 py-2 text-sm font-medium bg-surface-light hover:bg-surface text-foreground rounded-lg transition-colors border border-surface-light"
          >
            📄 Weekly Report (PDF{weeksBack > 0 ? ` · ${viewedMondayStr}` : ''})
          </button>
          <button
            onClick={() => {
              const m = `${period.currentYear}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
              onDownloadReport(
                `/api/v1/export/monthly-report/${m}`,
                `fittrack_monthly_${m}.pdf`,
              );
            }}
            className="px-4 py-2 text-sm font-medium bg-surface-light hover:bg-surface text-foreground rounded-lg transition-colors border border-surface-light"
          >
            📄 Monthly Report (PDF)
          </button>
        </div>
      </div>

      {/* ── Yearly Summary (shared section, BUG-041) ─────────────────────── */}
      <YearlySummarySection {...period} showBars />
    </div>
  );
}
