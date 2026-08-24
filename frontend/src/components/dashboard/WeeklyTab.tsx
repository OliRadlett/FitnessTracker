'use client';

import React from 'react';
import type {
  DashboardSummary,
  MonthlySummaryItem,
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
  YearlySummary,
  LlmAnalysis,
  DeficiencyResponse,
} from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Chart, ChartBody } from '@/components/charts/Chart';
import { useQuery } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import { ReadinessIndicator } from '@/components/ui/ReadinessIndicator';
import { SkeletonMetric } from '@/components/ui/Skeleton';
import { LlmAnalysisCard } from '@/components/cycling/LlmAnalysisCard';
import { HealthAiAnalysisCard } from '@/components/health/HealthAiAnalysisCard';
import { EventAiAnalysisCard } from '@/components/training/EventAiAnalysisCard';
import { MetricCard, WhoopWeeklyCard, RespiratoryRateCard, ActivityRow, SessionRow, ListSkeleton } from './helpers';
import { RestDayBanner } from './RestDayBanner';
import { HealthAlertsSection } from './HealthAlertsSection';
import { GoalsSection } from './GoalsSection';
import { DeficiencyCard } from './DeficiencyCard';

interface WeeklyTabProps {
  summary: DashboardSummary | undefined;
  summaryLoading: boolean;
  readiness: ReadinessResponse | undefined;
  hasReadiness: boolean;
  respiratoryRate: RespiratoryRateResponse | undefined;
  whoopWeekly: WhoopWeeklySummary | undefined;
  hasWhoop: boolean;
  weeklyTss: ChartData | undefined;
  tssLoading: boolean;
  strainVsRecovery: ChartData | undefined;
  activities: Activity[] | undefined;
  activitiesLoading: boolean;
  sessions: LiftingSession[] | undefined;
  sessionsLoading: boolean;
  recentSessions: LiftingSession[];
  streaks: TrainingStreaks | undefined;
  goals: Goal[] | undefined;
  deficiency: DeficiencyResponse | undefined;
  deficiencyLoading?: boolean;
  monthlySummary: MonthlySummaryItem[] | undefined;
  selectedYear: number;
  setSelectedYear: React.Dispatch<React.SetStateAction<number>>;
  currentYear: number;
  yearlySummary: YearlySummary | undefined;
  yearlyLoading: boolean;
  upcomingEvents: Event[] | undefined;
  llmAnalysis: LlmAnalysis | null | undefined;
  llmLoading: boolean;
  onRefreshLlm: () => void;
  isRefreshingLlm: boolean;
  analysisResults: HealthAnalysisResult[] | null;
  isAnalyzing: boolean;
  onAnalyze: () => void;
  onDownloadReport: (apiPath: string, filename: string) => void;
  getCurrentMonday: () => string;
}

export function WeeklyTab({
  summary,
  summaryLoading,
  readiness,
  hasReadiness,
  respiratoryRate,
  whoopWeekly,
  hasWhoop,
  weeklyTss,
  tssLoading,
  strainVsRecovery,
  activities,
  activitiesLoading,
  sessions,
  sessionsLoading,
  recentSessions,
  streaks,
  goals,
  deficiency,
  deficiencyLoading,
  monthlySummary,
  selectedYear,
  setSelectedYear,
  currentYear,
  yearlySummary,
  yearlyLoading,
  upcomingEvents,
  llmAnalysis,
  llmLoading,
  onRefreshLlm,
  isRefreshingLlm,
  analysisResults,
  isAnalyzing,
  onAnalyze,
  onDownloadReport,
  getCurrentMonday,
}: WeeklyTabProps) {
  const { authFetch } = useAuthFetch();

  const { data: hrvChart, isLoading: hrvLoading } = useQuery<ChartData>({
    queryKey: ['chart-hrv-trend-detailed', 90],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/hrv_trend_detailed?days=90'),
    staleTime: 300_000,
  });

  const { data: heatmapChart, isLoading: heatmapLoading } = useQuery<ChartData>({
    queryKey: ['chart-consistency-heatmap', 182],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/consistency_heatmap?days=182'),
    staleTime: 300_000,
  });

  return (
    <div className="space-y-8">
      {/* ── Rest Day Suggestion / Training Readiness ─────────────────────────── */}
      {summary?.rest_day_suggestion && (
        <RestDayBanner suggestion={summary.rest_day_suggestion} />
      )}

      {/* ── Upcoming Events Banner ──────────────────────────────────────────── */}
      {upcomingEvents && upcomingEvents.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {upcomingEvents.slice(0, 3).map(evt => (
            <div
              key={evt.id}
              className={`rounded-xl p-4 border ${
                evt.is_in_taper
                  ? 'bg-purple-900/20 border-purple-500/30'
                  : 'bg-surface border-surface-light/50'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-xl">{evt.event_type === 'race' ? '🏁' : evt.event_type === 'ride' ? '🚴' : evt.event_type === 'lift' ? '🏋️' : '📌'}</span>
                <div>
                  <p className="text-white font-medium text-sm">{evt.name}</p>
                  <p className="text-xs text-muted">{evt.event_date}</p>
                </div>
              </div>
              <p className="text-sm mt-2">
                {evt.days_until === 0 ? (
                  <span className="text-accent font-bold">🎯 Today!</span>
                ) : (
                  <span className="text-white">🎯 <strong>{evt.days_until}</strong> days away</span>
                )}
              </p>
              {evt.is_in_taper && (
                <p className="text-xs text-purple-300 mt-1">📉 Taper phase — reduce load</p>
              )}
              {evt.days_until_taper !== undefined && evt.days_until_taper > 0 && evt.days_until_taper <= 14 && (
                <p className="text-xs text-muted mt-1">Taper starts in {evt.days_until_taper} days</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Event AI Analysis (for nearest upcoming event) ────────────────────── */}
      {upcomingEvents && upcomingEvents.length > 0 && upcomingEvents[0].days_until <= 56 && (
        <EventAiAnalysisCard eventId={upcomingEvents[0].id} />
      )}

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
              : 'text-green-400'
            }
            icon="💪"
            tooltip="Whoop Strain (0-21) measures cardiovascular load. 0-9: low, 10-13: moderate, 14-17: high, 18+: all-out. Based on time in HR zones."
          />
          <MetricCard
            label="Active Alerts"
            value={summary?.active_alerts_count ?? 0}
            subtitle="Health warnings"
            color={(summary?.active_alerts_count ?? 0) > 0 ? 'text-warning' : 'text-green-400'}
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
                color="text-green-400"
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
                  : 'text-green-400'
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
          <Card className="flex items-center justify-center text-muted">
            <div className="text-center py-8">
              <p className="text-3xl mb-2">🩺</p>
              <p className="text-sm">Connect Whoop for weekly health insights</p>
            </div>
          </Card>
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

      {/* ── Training Charts ──────────────────────────────────────────────────── */}
      <div className="space-y-6">
        <div>
          <h2 className="text-sm font-medium text-muted uppercase tracking-wider mb-3">Training Load</h2>
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
                streaks.weekly_consistency_pct >= 75 ? 'text-green-400'
                : streaks.weekly_consistency_pct >= 50 ? 'text-yellow-400'
                : 'text-red-400'
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

      {/* ── Monthly Summary ──────────────────────────────────────────────── */}
      {monthlySummary && monthlySummary.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-muted uppercase tracking-wider mb-3">Monthly Summary</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {monthlySummary.map((month, i) => {
              const prevMonth = i < monthlySummary.length - 1 ? monthlySummary[i + 1] : null;
              const tssTrend = prevMonth && prevMonth.total_tss > 0
                ? ((month.total_tss - prevMonth.total_tss) / prevMonth.total_tss * 100)
                : null;
              const volTrend = prevMonth && prevMonth.lifting_volume_kg > 0
                ? ((month.lifting_volume_kg - prevMonth.lifting_volume_kg) / prevMonth.lifting_volume_kg * 100)
                : null;
              return (
                <Card key={month.month}>
                  <CardHeader>
                    <div className="flex items-center justify-between w-full">
                      <CardTitle>{new Date(month.month + '-01').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</CardTitle>
                      {month.pr_count > 0 && (
                        <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400">
                          🏆 {month.pr_count} PR{month.pr_count > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </CardHeader>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-muted">TSS</p>
                      <div className="flex items-center gap-1">
                        <p className="text-sm font-bold text-blue-400">{month.total_tss.toFixed(0)}</p>
                        {tssTrend !== null && (
                          <span className={`text-xs ${tssTrend > 5 ? 'text-positive' : tssTrend < -5 ? 'text-warning' : 'text-muted'}`}>
                            {tssTrend > 0 ? '↑' : tssTrend < 0 ? '↓' : '→'}
                          </span>
                        )}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-muted">Lifting Volume</p>
                      <div className="flex items-center gap-1">
                        <p className="text-sm font-bold text-purple-400">{(month.lifting_volume_kg / 1000).toFixed(1)}k kg</p>
                        {volTrend !== null && (
                          <span className={`text-xs ${volTrend > 5 ? 'text-positive' : volTrend < -5 ? 'text-warning' : 'text-muted'}`}>
                            {volTrend > 0 ? '↑' : volTrend < 0 ? '↓' : '→'}
                          </span>
                        )}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-muted">Distance</p>
                      <p className="text-sm font-bold text-green-400">{(month.total_distance_meters / 1000).toFixed(0)} km</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted">Time</p>
                      <p className="text-sm font-bold text-slate-300">{(month.total_time_seconds / 3600).toFixed(1)}h</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted">Sessions</p>
                      <p className="text-sm font-bold text-white">
                        {month.lifting_sessions + month.cardio_sessions}
                        <span className="text-xs text-muted ml-1">
                          ({month.lifting_sessions}🏋️ {month.cardio_sessions}🚴)
                        </span>
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted">Avg Recovery</p>
                      <p className={`text-sm font-bold ${
                        (month.avg_recovery ?? 0) >= 70 ? 'text-green-400'
                        : (month.avg_recovery ?? 0) >= 50 ? 'text-yellow-400'
                        : 'text-red-400'
                      }`}>
                        {month.avg_recovery?.toFixed(0) ?? '—'}%
                      </p>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Download Reports ─────────────────────────────────────────────── */}
      <div>
        <h2 className="text-sm font-medium text-muted uppercase tracking-wider mb-3">Download Reports</h2>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => onDownloadReport(
              `/api/v1/export/weekly-report/${getCurrentMonday()}`,
              `fittrack_weekly_${getCurrentMonday()}.pdf`,
            )}
            className="px-4 py-2 text-sm font-medium bg-surface-light hover:bg-surface text-white rounded-lg transition-colors border border-surface-light"
          >
            📄 Weekly Report (PDF)
          </button>
          <button
            onClick={() => {
              const m = `${currentYear}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
              onDownloadReport(
                `/api/v1/export/monthly-report/${m}`,
                `fittrack_monthly_${m}.pdf`,
              );
            }}
            className="px-4 py-2 text-sm font-medium bg-surface-light hover:bg-surface text-white rounded-lg transition-colors border border-surface-light"
          >
            📄 Monthly Report (PDF)
          </button>
        </div>
      </div>

      {/* ── Yearly Summary ──────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-muted uppercase tracking-wider">
            {selectedYear} Year in Review
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedYear((y) => y - 1)}
              className="px-2 py-1 text-xs bg-surface-light hover:bg-surface text-muted rounded-lg transition-colors"
            >
              ← {selectedYear - 1}
            </button>
            {selectedYear < currentYear && (
              <button
                onClick={() => setSelectedYear((y) => Math.min(y + 1, currentYear))}
                className="px-2 py-1 text-xs bg-surface-light hover:bg-surface text-muted rounded-lg transition-colors"
              >
                {selectedYear + 1} →
              </button>
            )}
            {selectedYear !== currentYear && (
              <button
                onClick={() => setSelectedYear(currentYear)}
                className="px-2 py-1 text-xs bg-accent/20 text-accent border border-accent/30 rounded-lg hover:bg-accent/30 transition-colors"
              >
                Current Year
              </button>
            )}
          </div>
        </div>

        {yearlyLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => <SkeletonMetric key={i} />)}
          </div>
        ) : yearlySummary ? (
          <div className="space-y-6">
            {/* Year-over-year comparison badges */}
            {yearlySummary.year_over_year && (
              <div className="flex flex-wrap gap-2">
                {[
                  { label: 'Activities', value: yearlySummary.year_over_year.activities_delta, pct: yearlySummary.year_over_year.activities_pct },
                  { label: 'TSS', value: Math.round(yearlySummary.year_over_year.tss_delta), pct: yearlySummary.year_over_year.tss_pct },
                  { label: 'Distance', value: Math.round(yearlySummary.year_over_year.distance_delta_m / 1000), pct: yearlySummary.year_over_year.distance_pct, unit: 'km' },
                  { label: 'Lifting Vol', value: Math.round(yearlySummary.year_over_year.lifting_volume_delta_kg / 1000), pct: yearlySummary.year_over_year.lifting_volume_pct, unit: 'k kg' },
                  { label: 'PRs', value: yearlySummary.year_over_year.prs_delta, pct: null },
                ].map((item) => (
                  <span
                    key={item.label}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${
                      (item.value ?? 0) > 0 ? 'bg-green-500/15 text-green-400 border border-green-500/20'
                      : (item.value ?? 0) < 0 ? 'bg-red-500/15 text-red-400 border border-red-500/20'
                      : 'bg-surface-light text-muted border border-surface-light'
                    }`}
                  >
                    {item.label}: {item.value > 0 ? '+' : ''}{item.value}{item.unit ? ` ${item.unit}` : ''}
                    {item.pct !== null && item.pct !== undefined && (
                      <span className="opacity-75">({item.pct > 0 ? '+' : ''}{item.pct.toFixed(0)}%)</span>
                    )}
                  </span>
                ))}
                <span className="text-xs text-muted self-center ml-1">vs {selectedYear - 1}</span>
              </div>
            )}

            {/* Year totals */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <MetricCard label="Activities" value={yearlySummary.total_activities} subtitle="Cardio sessions" color="text-blue-400" icon="🚴" />
              <MetricCard label="Distance" value={`${(yearlySummary.total_distance_m / 1000).toFixed(0)} km`} subtitle="Total distance" color="text-green-400" icon="📏" />
              <MetricCard label="TSS" value={yearlySummary.total_tss.toFixed(0)} subtitle="Training Stress" color="text-accent" icon="⚡" />
              <MetricCard label="Lifting" value={`${yearlySummary.total_lifting_sessions}`} subtitle={`${(yearlySummary.total_lifting_volume_kg / 1000).toFixed(0)}k kg vol`} color="text-purple-400" icon="🏋️" />
              <MetricCard label="Time" value={`${(yearlySummary.total_time_s / 3600).toFixed(0)}h`} subtitle="Cardio hours" color="text-slate-300" icon="⏱️" />
              <MetricCard label="Recovery" value={yearlySummary.avg_recovery ? `${yearlySummary.avg_recovery.toFixed(0)}%` : '—'} subtitle={yearlySummary.avg_hrv_ms ? `HRV: ${yearlySummary.avg_hrv_ms.toFixed(0)}ms` : 'Avg recovery'} color={(yearlySummary.avg_recovery ?? 0) >= 70 ? 'text-green-400' : 'text-yellow-400'} icon="❤️" />
            </div>

            {/* Highlight cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {yearlySummary.highlights.best_month_tss && (
                <div className="bg-surface rounded-xl border border-surface-light/50 p-4">
                  <p className="text-xs font-medium text-muted uppercase tracking-wider mb-1">🏆 Best Month (TSS)</p>
                  <p className="text-lg font-bold text-yellow-400">
                    {new Date(yearlySummary.highlights.best_month_tss + '-01').toLocaleDateString(undefined, { month: 'long' })}
                  </p>
                  <p className="text-xs text-muted">{yearlySummary.highlights.best_month_tss_value.toFixed(0)} TSS</p>
                </div>
              )}
              <div className="bg-surface rounded-xl border border-surface-light/50 p-4">
                <p className="text-xs font-medium text-muted uppercase tracking-wider mb-1">🏅 Total PRs</p>
                <p className="text-lg font-bold text-orange-400">{yearlySummary.highlights.total_prs}</p>
                <p className="text-xs text-muted">Personal records set</p>
              </div>
              {yearlySummary.highlights.longest_ride && (
                <div className="bg-surface rounded-xl border border-surface-light/50 p-4">
                  <p className="text-xs font-medium text-muted uppercase tracking-wider mb-1">🚴 Longest Ride</p>
                  <p className="text-lg font-bold text-green-400">{yearlySummary.highlights.longest_ride.value} {yearlySummary.highlights.longest_ride.unit}</p>
                  <p className="text-xs text-muted truncate">{yearlySummary.highlights.longest_ride.name}</p>
                </div>
              )}
              {yearlySummary.highlights.heaviest_lift && (
                <div className="bg-surface rounded-xl border border-surface-light/50 p-4">
                  <p className="text-xs font-medium text-muted uppercase tracking-wider mb-1">🏋️ Heaviest Lift</p>
                  <p className="text-lg font-bold text-purple-400">{yearlySummary.highlights.heaviest_lift.value} {yearlySummary.highlights.heaviest_lift.unit}</p>
                  <p className="text-xs text-muted truncate">{yearlySummary.highlights.heaviest_lift.name}</p>
                </div>
              )}
            </div>

            {/* PR highlights table */}
            {yearlySummary.highlights.pr_highlights.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>🏅 PR Highlights</CardTitle>
                </CardHeader>
                <div className="space-y-2">
                  {yearlySummary.highlights.pr_highlights.map((pr, i) => (
                    <div key={i} className="flex items-center justify-between p-3 bg-surface-light/30 rounded-lg">
                      <div>
                        <p className="text-sm font-medium text-white">{pr.exercise_name}</p>
                        <p className="text-xs text-muted">
                          {pr.record_type} — {pr.weight_kg}kg × {pr.reps}
                          {pr.estimated_1rm && ` (1RM: ${pr.estimated_1rm.toFixed(1)}kg)`}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted">{new Date(pr.achieved_date).toLocaleDateString()}</p>
                        {pr.improvement_pct !== null && pr.improvement_pct !== undefined && (
                          <span className={`text-xs font-medium ${pr.improvement_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {pr.improvement_pct > 0 ? '+' : ''}{pr.improvement_pct}%
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Monthly bar charts */}
            {yearlySummary.months.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Monthly TSS</CardTitle>
                  </CardHeader>
                  <div className="flex items-end gap-1.5 h-32">
                    {yearlySummary.months.map((m) => {
                      const maxTss = Math.max(...yearlySummary.months.map((x) => x.total_tss), 1);
                      const h = (m.total_tss / maxTss) * 100;
                      return (
                        <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                          <span className="text-[9px] text-muted">{m.total_tss > 0 ? Math.round(m.total_tss) : ''}</span>
                          <div className="w-full bg-surface-light/40 rounded-t" style={{ height: `${Math.max(h, 2)}%` }}>
                            <div className="w-full h-full bg-blue-500/60 rounded-t" />
                          </div>
                          <span className="text-[9px] text-muted">{m.month.slice(5)}</span>
                        </div>
                      );
                    })}
                  </div>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Monthly Distance (km)</CardTitle>
                  </CardHeader>
                  <div className="flex items-end gap-1.5 h-32">
                    {yearlySummary.months.map((m) => {
                      const km = m.total_distance_meters / 1000;
                      const maxKm = Math.max(...yearlySummary.months.map((x) => x.total_distance_meters / 1000), 1);
                      const h = (km / maxKm) * 100;
                      return (
                        <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                          <span className="text-[9px] text-muted">{km > 0 ? Math.round(km) : ''}</span>
                          <div className="w-full bg-surface-light/40 rounded-t" style={{ height: `${Math.max(h, 2)}%` }}>
                            <div className="w-full h-full bg-green-500/60 rounded-t" />
                          </div>
                          <span className="text-[9px] text-muted">{m.month.slice(5)}</span>
                        </div>
                      );
                    })}
                  </div>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Monthly Volume (k kg)</CardTitle>
                  </CardHeader>
                  <div className="flex items-end gap-1.5 h-32">
                    {yearlySummary.months.map((m) => {
                      const vol = m.lifting_volume_kg / 1000;
                      const maxVol = Math.max(...yearlySummary.months.map((x) => x.lifting_volume_kg / 1000), 1);
                      const h = (vol / maxVol) * 100;
                      return (
                        <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                          <span className="text-[9px] text-muted">{vol > 0 ? vol.toFixed(1) : ''}</span>
                          <div className="w-full bg-surface-light/40 rounded-t" style={{ height: `${Math.max(h, 2)}%` }}>
                            <div className="w-full h-full bg-purple-500/60 rounded-t" />
                          </div>
                          <span className="text-[9px] text-muted">{m.month.slice(5)}</span>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              </div>
            )}
          </div>
        ) : (
          <Card>
            <div className="text-center py-8">
              <p className="text-3xl mb-2">📅</p>
              <p className="text-muted text-sm">No data for {selectedYear} yet</p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
