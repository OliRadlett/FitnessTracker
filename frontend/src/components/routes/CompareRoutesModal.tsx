'use client';

import type { RouteData } from '@/lib/api';
import { Badge } from '@/components/ui/Badge';
import { SurfaceBreakdown } from '@/components/maps/SurfaceBreakdown';
import { formatDistance } from '@/lib/utils';
import { decodePolyline } from '@/lib/polyline';
import { Modal } from '@/components/ui/Modal';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtElevation(meters: number): string {
  return `${Math.round(meters)} m`;
}

function fmtDurationShort(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

// ── Difficulty ───────────────────────────────────────────────────────────────

type DifficultyLevel = 'Easy' | 'Moderate' | 'Hard' | 'Extreme';

function computeDifficulty(
  elevationGainMeters: number | undefined | null,
  distanceMeters: number,
): DifficultyLevel | null {
  if (!elevationGainMeters || elevationGainMeters <= 0) return null;
  if (distanceMeters <= 0) return null;
  const elevPerKm = elevationGainMeters / (distanceMeters / 1000);
  if (elevPerKm < 10) return 'Easy';
  if (elevPerKm < 20) return 'Moderate';
  if (elevPerKm < 40) return 'Hard';
  return 'Extreme';
}

const DIFFICULTY_STYLES: Record<DifficultyLevel, string> = {
  Easy: 'bg-green-500/20 text-positive border-green-500/30',
  Moderate: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  Hard: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  Extreme: 'bg-red-500/20 text-warning border-red-500/30',
};

function DifficultyBadge({ level }: { level: DifficultyLevel }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${DIFFICULTY_STYLES[level]}`}
    >
      {level}
    </span>
  );
}

// ── Haversine for elevation profile overlay ──────────────────────────────────

function haversineDist(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildElevationData(encodedPolyline: string, elevations: (number | null)[]) {
  const points = decodePolyline(encodedPolyline);
  if (points.length === 0) return [];
  const result: { distance: number; elevation: number }[] = [];
  let cumDist = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      cumDist += haversineDist(
        points[i - 1][0], points[i - 1][1],
        points[i][0], points[i][1],
      );
    }
    const ele = elevations[i] ?? null;
    if (ele !== null) {
      result.push({
        distance: Math.round(cumDist / 100) / 10,
        elevation: Math.round(ele),
      });
    }
  }
  return result;
}

// ── Compare Routes Modal ─────────────────────────────────────────────────────

export function CompareRoutesModal({
  routeA,
  routeB,
  onClose,
}: {
  routeA: RouteData;
  routeB: RouteData;
  onClose: () => void;
}) {
  const diffA = computeDifficulty(routeA.elevation_gain_meters, routeA.distance_meters);
  const diffB = computeDifficulty(routeB.elevation_gain_meters, routeB.distance_meters);

  // Build overlaid elevation data
  const elevDataA = routeA.elevation_profile?.elevations
    ? buildElevationData(routeA.encoded_polyline, routeA.elevation_profile.elevations)
    : [];
  const elevDataB = routeB.elevation_profile?.elevations
    ? buildElevationData(routeB.encoded_polyline, routeB.elevation_profile.elevations)
    : [];

  // Merge into a single dataset for Recharts
  const maxLen = Math.max(elevDataA.length, elevDataB.length);
  const overlayData = Array.from({ length: maxLen }, (_, i) => ({
    distance: elevDataA[i]?.distance ?? elevDataB[i]?.distance ?? 0,
    elevationA: elevDataA[i]?.elevation ?? null,
    elevationB: elevDataB[i]?.elevation ?? null,
  }));

  // Stats delta
  const distDelta = routeA.distance_meters - routeB.distance_meters;
  const elevDelta = (routeA.elevation_gain_meters ?? 0) - (routeB.elevation_gain_meters ?? 0);
  const timeDelta = (routeA.estimated_time_seconds ?? 0) - (routeB.estimated_time_seconds ?? 0);

  return (
    <Modal open onClose={onClose} size="xl" aria-label="Compare Routes">
      <div className="flex items-center justify-between pb-4 mb-4 border-b border-surface-light/50">
        <h2 className="text-lg font-semibold text-white">Compare Routes</h2>
        <button
          onClick={onClose}
          className="text-muted hover:text-white transition-colors text-xl leading-none"
          aria-label="Close comparison"
        >
          {'\u2715'}
        </button>
      </div>

        <div className="p-4 space-y-6">
          {/* Side-by-side header */}
          <div className="grid grid-cols-2 gap-4">
            {[routeA, routeB].map((r) => {
              const diff = computeDifficulty(r.elevation_gain_meters, r.distance_meters);
              return (
                <div key={r.id} className="bg-surface-light/30 rounded-lg p-4">
                  <h3 className="text-white font-medium mb-2 truncate">{r.name}</h3>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {diff && <DifficultyBadge level={diff} />}
                    {r.is_loop && <Badge variant="positive">Loop</Badge>}
                  </div>
                  <div className="space-y-1 text-sm text-muted">
                    <p>{'\u{1F4CF}'} {formatDistance(r.distance_meters)}</p>
                    {r.elevation_gain_meters != null && (
                      <p>{'\u26F0\uFE0F'} {fmtElevation(r.elevation_gain_meters)}</p>
                    )}
                    {r.estimated_time_seconds != null && (
                      <p>{'\u23F1\uFE0F'} {fmtDurationShort(r.estimated_time_seconds)}</p>
                    )}
                  </div>
                  {r.surface_profile && Object.keys(r.surface_profile).length > 0 && (
                    <div className="mt-3">
                      <SurfaceBreakdown surfaceProfile={r.surface_profile} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Overlaid elevation profile */}
          {overlayData.length > 0 && overlayData.some((d) => d.elevationA != null || d.elevationB != null) && (
            <div>
              <h4 className="text-xs text-muted mb-2 uppercase tracking-wider">Elevation Profile Overlay</h4>
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={overlayData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                  <defs>
                    <linearGradient id="elevGradA" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="elevGradB" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis
                    dataKey="distance"
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: '#475569' }}
                    label={{ value: 'km', position: 'insideBottomRight', offset: -5, fill: '#64748b', fontSize: 10 }}
                  />
                  <YAxis
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: '#475569' }}
                    label={{ value: 'm', position: 'insideTopLeft', offset: 10, fill: '#64748b', fontSize: 10 }}
                    domain={['dataMin - 10', 'dataMax + 10']}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1e293b',
                      border: '1px solid #334155',
                      borderRadius: '8px',
                      color: '#e2e8f0',
                      fontSize: '12px',
                    }}
                    formatter={(value: number, name: string) => [
                      `${value} m`,
                      name === 'elevationA' ? routeA.name : routeB.name,
                    ]}
                    labelFormatter={(label: number) => `${label} km`}
                  />
                  <Legend
                    formatter={(value: string) =>
                      value === 'elevationA' ? routeA.name : routeB.name
                    }
                    wrapperStyle={{ fontSize: '12px', color: '#94a3b8' }}
                  />
                  <Area
                    type="monotone"
                    dataKey="elevationA"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    fill="url(#elevGradA)"
                    connectNulls
                  />
                  <Area
                    type="monotone"
                    dataKey="elevationB"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    fill="url(#elevGradB)"
                    connectNulls
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Stats delta table */}
          <div>
            <h4 className="text-xs text-muted mb-2 uppercase tracking-wider">Stats Comparison</h4>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted border-b border-surface-light/50">
                  <th className="text-left py-2">Metric</th>
                  <th className="text-right py-2">{routeA.name}</th>
                  <th className="text-right py-2">{routeB.name}</th>
                  <th className="text-right py-2">{'\u0394'}</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-surface-light/30">
                  <td className="py-2 text-muted">Distance</td>
                  <td className="py-2 text-right text-white">{formatDistance(routeA.distance_meters)}</td>
                  <td className="py-2 text-right text-white">{formatDistance(routeB.distance_meters)}</td>
                  <td className={`py-2 text-right ${distDelta > 0 ? 'text-positive' : distDelta < 0 ? 'text-warning' : 'text-muted'}`}>
                    {distDelta > 0 ? '+' : ''}{formatDistance(Math.abs(distDelta))}
                  </td>
                </tr>
                <tr className="border-b border-surface-light/30">
                  <td className="py-2 text-muted">Elevation</td>
                  <td className="py-2 text-right text-white">{routeA.elevation_gain_meters != null ? fmtElevation(routeA.elevation_gain_meters) : '\u2014'}</td>
                  <td className="py-2 text-right text-white">{routeB.elevation_gain_meters != null ? fmtElevation(routeB.elevation_gain_meters) : '\u2014'}</td>
                  <td className={`py-2 text-right ${elevDelta > 0 ? 'text-positive' : elevDelta < 0 ? 'text-warning' : 'text-muted'}`}>
                    {elevDelta > 0 ? '+' : ''}{fmtElevation(Math.abs(elevDelta))}
                  </td>
                </tr>
                <tr className="border-b border-surface-light/30">
                  <td className="py-2 text-muted">Difficulty</td>
                  <td className="py-2 text-right">{diffA ? <DifficultyBadge level={diffA} /> : '\u2014'}</td>
                  <td className="py-2 text-right">{diffB ? <DifficultyBadge level={diffB} /> : '\u2014'}</td>
                  <td className="py-2 text-right text-muted">{'\u2014'}</td>
                </tr>
                <tr>
                  <td className="py-2 text-muted">Est. Time</td>
                  <td className="py-2 text-right text-white">{routeA.estimated_time_seconds ? fmtDurationShort(routeA.estimated_time_seconds) : '\u2014'}</td>
                  <td className="py-2 text-right text-white">{routeB.estimated_time_seconds ? fmtDurationShort(routeB.estimated_time_seconds) : '\u2014'}</td>
                  <td className={`py-2 text-right ${timeDelta > 0 ? 'text-positive' : timeDelta < 0 ? 'text-warning' : 'text-muted'}`}>
                    {timeDelta > 0 ? '+' : ''}{timeDelta !== 0 ? fmtDurationShort(Math.abs(timeDelta)) : '\u2014'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
    </Modal>
  );
}
