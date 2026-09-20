import React from 'react';
import type { PowerCurveResponse } from '@/lib/api';

export function PowerCurveTable({ data, ftpWatts, wkgByLabel }: { data: PowerCurveResponse['data']; ftpWatts?: number | null; wkgByLabel?: Map<string, number | null> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-surface-light/50">
            <th className="text-left py-2 text-muted font-medium">Duration</th>
            <th className="text-right py-2 text-muted font-medium">Best Power</th>
            <th className="text-right py-2 text-muted font-medium">% FTP</th>
            <th className="text-right py-2 text-muted font-medium">W/kg</th>
          </tr>
        </thead>
        <tbody>
          {data.map((point) => {
            const power = point.best_power_watts;
            const pctFtp = power && ftpWatts ? ((power / ftpWatts) * 100).toFixed(0) : '—';
            // W/kg from the wkg_power_curve chart (server-normalized by latest
            // body weight, same duration buckets). '—' when that chart is
            // unavailable or fell back to raw watts (no weight logged).
            const wkg = wkgByLabel?.get(point.duration_label) ?? null;
            return (
              <tr key={point.duration_label} className="border-b border-surface-light/20 hover:bg-surface-light/20">
                <td className="py-2 text-white font-medium">{point.duration_label}</td>
                <td className="py-2 text-right text-yellow-400 font-mono">
                  {power ? `${power} W` : '—'}
                </td>
                <td className="py-2 text-right text-muted font-mono">
                  {pctFtp !== '—' ? `${pctFtp}%` : '—'}
                </td>
                <td className="py-2 text-right text-muted font-mono">
                  {wkg != null ? wkg.toFixed(2) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
