'use client';

import React from 'react';
import Link from 'next/link';
import type { ChartData, FtpHistoryEntry, LifetimePBsResponse, CyclingProfile, CyclingPowerRecord, FtpEstimate } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { ChartBody } from '@/components/charts/Chart';
import { PRCelebration, type PREvent } from '@/components/ui/PRCelebration';

interface FtpSectionProps {
  profile: CyclingProfile | undefined;
  ftpHistory: FtpHistoryEntry[] | undefined;
  chartFtpHistory: ChartData | undefined;
  lifetimePBs: LifetimePBsResponse | undefined;
  backfillFtpResult: string | null;
  onBackfillFtp: () => void;
   isBackfillingFtp: boolean;
   ftpEstimate: FtpEstimate | null;
  cyclingPRs: CyclingPowerRecord[] | undefined;
  cyclingPRsLoading: boolean;
  celebrationPR: PREvent | null;
  onDismissCelebration: () => void;
  onCheckPRs: () => void;
  isCheckingPRs: boolean;
  onInvalidatePRs: () => void;
}

export function FtpSection({
  profile,
  ftpHistory,
  chartFtpHistory,
  lifetimePBs,
  backfillFtpResult,
  onBackfillFtp,
  isBackfillingFtp,
  cyclingPRs,
  cyclingPRsLoading,
  celebrationPR,
  onDismissCelebration,
  onCheckPRs,
  isCheckingPRs,
  onInvalidatePRs,
}: FtpSectionProps) {
  return (
    <>
      {/* PR Celebration Toast */}
      <PRCelebration pr={celebrationPR} onDismiss={onDismissCelebration} />

      {/* FTP History Chart + Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between w-full">
            <CardTitle>📈 FTP Progression</CardTitle>
            <button
              onClick={onBackfillFtp}
              disabled={isBackfillingFtp}
              className="px-3 py-1.5 text-xs bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded-lg hover:bg-purple-500/30 transition-colors disabled:opacity-50 font-medium"
            >
              {isBackfillingFtp ? 'Backfilling...' : '📊 Backfill FTP History'}
            </button>
          </div>
        </CardHeader>
        {backfillFtpResult && (
          <p className={`text-xs mb-3 ${backfillFtpResult.startsWith('Error') ? 'text-warning' : 'text-positive'}`}>
            {backfillFtpResult}
          </p>
        )}
        <div className="mb-4 text-sm text-muted">
          Current FTP: <span className="text-yellow-400 font-mono font-bold">{profile?.ftp_watts ?? '—'} W</span>
          {profile?.weight_kg && profile?.ftp_watts && (
            <span className="ml-4">
              W/kg: <span className="text-positive font-mono font-bold">
                {(profile.ftp_watts / profile.weight_kg).toFixed(2)}
              </span>
            </span>
          )}
        </div>
        <ChartBody
          data={chartFtpHistory}
          emptyMessage='No FTP history yet. Use "Auto-Estimate & Save FTP" or manually set your FTP to start tracking.'
          height={250}
        />
        {ftpHistory && ftpHistory.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-light/50">
                  <th className="text-left py-2 text-muted font-medium">Date</th>
                  <th className="text-right py-2 text-muted font-medium">FTP (W)</th>
                  <th className="text-left py-2 text-muted font-medium">Source</th>
                  <th className="text-left py-2 text-muted font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {ftpHistory.map((entry) => (
                  <tr key={entry.id} className="border-b border-surface-light/20 hover:bg-surface-light/20">
                    <td className="py-2 text-white">{new Date(entry.effective_date).toLocaleDateString()}</td>
                    <td className="py-2 text-right text-yellow-400 font-mono">{entry.ftp_watts} W</td>
                    <td className="py-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        entry.source === 'estimated' ? 'bg-blue-500/20 text-blue-400' : 'bg-surface-light text-muted'
                      }`}>
                        {entry.source}
                      </span>
                    </td>
                    <td className="py-2 text-muted text-xs">{entry.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Lifetime Power PBs — enhanced with dates and activity links */}
      {lifetimePBs && lifetimePBs.pbs.some(p => p.best_power_watts != null) && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between w-full">
              <CardTitle>🏆 Lifetime Power PBs</CardTitle>
              <button
                onClick={onCheckPRs}
                disabled={isCheckingPRs}
                className="px-3 py-1.5 text-xs bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 rounded-lg hover:bg-yellow-500/30 transition-colors disabled:opacity-50 font-medium"
              >
                {isCheckingPRs ? 'Checking...' : '🔍 Check for PRs'}
              </button>
            </div>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-light/50">
                  <th className="text-left py-2 text-muted font-medium">Duration</th>
                  <th className="text-right py-2 text-muted font-medium">Best Power</th>
                  {profile?.weight_kg && (
                    <th className="text-right py-2 text-muted font-medium">W/kg</th>
                  )}
                  {lifetimePBs.ftp_watts && (
                    <th className="text-right py-2 text-muted font-medium">% FTP</th>
                  )}
                  <th className="text-right py-2 text-muted font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {lifetimePBs.pbs.filter(p => p.best_power_watts != null).map((pb) => (
                  <tr key={pb.duration_label} className="border-b border-surface-light/20 hover:bg-surface-light/20">
                    <td className="py-2 text-white font-medium">{pb.duration_label}</td>
                    <td className="py-2 text-right text-yellow-400 font-mono">
                      {pb.best_power_watts} W
                    </td>
                    {profile?.weight_kg && pb.best_power_watts && (
                      <td className="py-2 text-right text-positive font-mono">
                        {(pb.best_power_watts / profile.weight_kg).toFixed(2)}
                      </td>
                    )}
                    {lifetimePBs.ftp_watts && (
                      <td className="py-2 text-right text-muted font-mono">
                        {pb.pct_ftp ?? '—'}%
                      </td>
                    )}
                    <td className="py-2 text-right text-muted text-xs">
                      {pb.date_achieved
                        ? new Date(pb.date_achieved).toLocaleDateString()
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Cycling Power PRs — stored PRs with dates, improvements, and activity links */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between w-full">
            <CardTitle>⚡ Power PRs</CardTitle>
            {cyclingPRs && cyclingPRs.length > 0 && (
              <button
                onClick={onInvalidatePRs}
                className="px-3 py-1.5 text-xs bg-accent/20 text-accent border border-accent/30 rounded-lg hover:bg-accent/30 transition-colors font-medium"
              >
                🔄 Refresh
              </button>
            )}
          </div>
        </CardHeader>
        {cyclingPRsLoading ? (
          <div className="h-48 flex items-center justify-center">
            <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-accent"></div>
          </div>
        ) : cyclingPRs && cyclingPRs.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-light/50">
                  <th className="text-left py-2 text-muted font-medium">Duration</th>
                  <th className="text-right py-2 text-muted font-medium">Power</th>
                  <th className="text-right py-2 text-muted font-medium">W/kg</th>
                  <th className="text-right py-2 text-muted font-medium">Improvement</th>
                  <th className="text-right py-2 text-muted font-medium">Date</th>
                  <th className="text-right py-2 text-muted font-medium">Activity</th>
                </tr>
              </thead>
              <tbody>
                {cyclingPRs.map((pr) => (
                  <tr key={pr.duration_label} className="border-b border-surface-light/20 hover:bg-surface-light/20">
                    <td className="py-2 text-white font-medium">{pr.duration_label}</td>
                    <td className="py-2 text-right text-yellow-400 font-mono">
                      {pr.power_watts.toFixed(0)} W
                    </td>
                    <td className="py-2 text-right text-positive font-mono">
                      {pr.w_per_kg ? `${pr.w_per_kg.toFixed(2)}` : '—'}
                    </td>
                    <td className="py-2 text-right font-mono">
                      {pr.improvement_pct != null ? (
                        pr.improvement_pct > 0 ? (
                          <span className="text-positive">+{pr.improvement_pct.toFixed(1)}%</span>
                        ) : (
                          <span className="text-muted">{pr.improvement_pct.toFixed(1)}%</span>
                        )
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-2 text-right text-muted text-xs">
                      {new Date(pr.achieved_date).toLocaleDateString()}
                    </td>
                    <td className="py-2 text-right">
                      {pr.activity_id ? (
                        <Link
                          href={`/activities?activity=${pr.activity_id}`}
                          className="text-xs text-accent hover:text-accent-hover transition-colors"
                        >
                          Link →
                        </Link>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="h-48 flex flex-col items-center justify-center text-muted text-sm">
            <p>No power PRs yet</p>
            <p className="text-xs mt-1">
              PRs are auto-detected when you sync cycling activities with power data.
              Click "Check for PRs" to scan existing activities.
            </p>
          </div>
        )}
      </Card>
    </>
  );
}
