'use client';

import React from 'react';
import type { ChartData, FtpHistoryEntry, FtpEstimate, BackfillFtpResult, LifetimePBsResponse, CyclingProfile } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { ChartBody } from '@/components/charts/Chart';

interface FtpSectionProps {
  profile: CyclingProfile | undefined;
  ftpHistory: FtpHistoryEntry[] | undefined;
  chartFtpHistory: ChartData | undefined;
  lifetimePBs: LifetimePBsResponse | undefined;
  ftpEstimate: FtpEstimate | null;
  backfillFtpResult: string | null;
  onBackfillFtp: () => void;
  isBackfillingFtp: boolean;
}

export function FtpSection({
  profile,
  ftpHistory,
  chartFtpHistory,
  lifetimePBs,
  backfillFtpResult,
  onBackfillFtp,
  isBackfillingFtp,
}: FtpSectionProps) {
  return (
    <>
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

      {/* Lifetime Power PBs */}
      {lifetimePBs && lifetimePBs.pbs.some(p => p.best_power_watts != null) && (
        <Card>
          <CardHeader>
            <CardTitle>🏆 Lifetime Power PBs</CardTitle>
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
                </tr>
              </thead>
              <tbody>
                {lifetimePBs.pbs.filter(p => p.best_power_watts != null).map((pb) => (
                  <tr key={pb.duration_label} className="border-b border-surface-light/20 hover:bg-surface-light/20">
                    <td className="py-2 text-white font-medium">{pb.duration_label}</td>
                    <td className="py-2 text-right text-yellow-400 font-mono">
                      {pb.best_power_watts} W
                    </td>
                    {profile?.weight_kg && (
                      <td className="py-2 text-right text-positive font-mono">
                        {(pb.best_power_watts! / profile.weight_kg).toFixed(2)}
                      </td>
                    )}
                    {lifetimePBs.ftp_watts && (
                      <td className="py-2 text-right text-muted font-mono">
                        {pb.pct_ftp ?? '—'}%
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
