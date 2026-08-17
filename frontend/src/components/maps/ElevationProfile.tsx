'use client';

import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { decodePolyline } from '@/lib/polyline';

interface ElevationProfileProps {
  encodedPolyline: string;
  elevations: (number | null)[];
  className?: string;
  onHover?: (index: number | null) => void;
}

function haversineDistance(
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

interface ElevationPoint {
  distance: number;
  elevation: number;
}

export function ElevationProfile({
  encodedPolyline,
  elevations,
  className = '',
}: ElevationProfileProps) {
  const data = useMemo(() => {
    const points = decodePolyline(encodedPolyline);
    if (points.length === 0) return [];

    const result: ElevationPoint[] = [];
    let cumDistance = 0;

    for (let i = 0; i < points.length; i++) {
      if (i > 0) {
        cumDistance += haversineDistance(
          points[i - 1][0], points[i - 1][1],
          points[i][0], points[i][1],
        );
      }

      const ele = elevations[i] ?? null;
      if (ele !== null) {
        result.push({
          distance: Math.round(cumDistance / 100) / 10, // km with 1 decimal
          elevation: Math.round(ele),
        });
      }
    }

    return result;
  }, [encodedPolyline, elevations]);

  if (data.length === 0) {
    return null;
  }

  return (
    <div className={className}>
      <h3 className="text-sm font-medium text-muted mb-2">Elevation Profile</h3>
      <ResponsiveContainer width="100%" height={150}>
        <AreaChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
          <defs>
            <linearGradient id="elevGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
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
            formatter={(value: number) => [`${value} m`, 'Elevation']}
            labelFormatter={(label: number) => `${label} km`}
          />
          <Area
            type="monotone"
            dataKey="elevation"
            stroke="#3b82f6"
            strokeWidth={2}
            fill="url(#elevGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
