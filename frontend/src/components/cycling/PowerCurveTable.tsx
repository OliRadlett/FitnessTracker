import React from 'react';
import type { PowerCurveResponse } from '@/lib/api';

export function PowerCurveTable({ data, ftpWatts }: { data: PowerCurveResponse['data']; ftpWatts?: number | null }) {
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
            // W/kg not applicable to power curve (no weight at that moment)
            return (
              <tr key={point.duration_label} className="border-b border-surface-light/20 hover:bg-surface-light/20">
                <td className="py-2 text-white font-medium">{point.duration_label}</td>
                <td className="py-2 text-right text-yellow-400 font-mono">
                  {power ? `${power} W` : '—'}
                </td>
                <td className="py-2 text-right text-muted font-mono">
                  {pctFtp !== '—' ? `${pctFtp}%` : '—'}
                </td>
                <td className="py-2 text-right text-muted font-mono">—</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
