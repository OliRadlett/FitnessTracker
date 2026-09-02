'use client';

import React, { useRef, useEffect, useMemo } from 'react';
import type { MergedRouteView } from '@/lib/api/types';
import { decodePolyline } from '@/lib/polyline';

/**
 * Renders a merged route with ride frequency heatmap coloring.
 * Sections ridden more often appear in warmer/darker colors.
 */
export function MergedRouteMapView({
  mergedRoute,
}: {
  mergedRoute: MergedRouteView;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<unknown>(null);

  const { encoded_polyline, sources, ridden_segments } = mergedRoute;

  const decodedMain = useMemo(
    () => decodePolyline(encoded_polyline),
    [encoded_polyline],
  );

  const decodedSegments = useMemo(
    () =>
      ridden_segments.map((seg) => ({
        points: decodePolyline(seg.encoded_polyline),
      })),
    [ridden_segments],
  );

  // Compute ride frequency for each point along the main route
  const frequencyData = useMemo(() => {
    if (decodedMain.length < 2 || decodedSegments.length === 0) return null;

    // Sample points along main route every ~50m
    const sampleDistance = 50;
    const mainPoints = decodedMain;

    // Compute cumulative distances along main route
    const cumDist = [0];
    for (let i = 1; i < mainPoints.length; i++) {
      const [lat1, lng1] = mainPoints[i - 1];
      const [lat2, lng2] = mainPoints[i];
      const d = haversine(lat1, lng1, lat2, lng2);
      cumDist.push(cumDist[i - 1] + d);
    }
    const totalDist = cumDist[cumDist.length - 1];

    // Sample points at regular intervals
    const samples: { lat: number; lng: number; dist: number }[] = [];
    for (let d = 0; d <= totalDist; d += sampleDistance) {
      // Find segment containing this distance
      let segIdx = 0;
      while (segIdx < cumDist.length - 1 && cumDist[segIdx + 1] < d) segIdx++;
      
      const segStart = cumDist[segIdx];
      const segEnd = cumDist[segIdx + 1] ?? totalDist;
      const frac = segEnd > segStart ? (d - segStart) / (segEnd - segStart) : 0;
      
      const [lat1, lng1] = mainPoints[segIdx];
      const [lat2, lng2] = mainPoints[Math.min(segIdx + 1, mainPoints.length - 1)];
      
      samples.push({
        lat: lat1 + frac * (lat2 - lat1),
        lng: lng1 + frac * (lng2 - lng1),
        dist: d,
      });
    }

    // For each sample, count how many activities pass nearby
    const threshold = 100; // meters
    const frequencies = samples.map((s) => {
      let count = 0;
      for (const seg of decodedSegments) {
        // Check if any point in this segment is near the sample
        for (const [lat, lng] of seg.points) {
          if (haversine(s.lat, s.lng, lat, lng) < threshold) {
            count++;
            break;
          }
        }
      }
      return { ...s, count };
    });

    return frequencies;
  }, [decodedMain, decodedSegments]);

  useEffect(() => {
    if (!mapRef.current || decodedMain.length === 0) return;

    let cleanup: (() => void) | undefined;

    const initMap = async () => {
      const L = (await import('leaflet')).default;

      if (mapInstanceRef.current) {
        (mapInstanceRef.current as { remove: () => void }).remove();
        mapInstanceRef.current = null;
      }

      const map = L.map(mapRef.current!, {
        zoomControl: true,
        scrollWheelZoom: true,
      });
      mapInstanceRef.current = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      const allBounds: [number, number][] = [];

      // Draw base route as white background
      if (decodedMain.length > 0) {
        const latLngs: [number, number][] = decodedMain.map(([lat, lng]) => [lat, lng]);
        allBounds.push(...latLngs);

        L.polyline(latLngs, {
          color: '#f8fafc',
          weight: 10,
          opacity: 0.95,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(map);
      }

      // Draw frequency-colored segments
      if (frequencyData && frequencyData.length > 1) {
        const maxCount = Math.max(...frequencyData.map((d) => d.count), 1);

        // Draw each segment with color based on frequency
        for (let i = 0; i < frequencyData.length - 1; i++) {
          const p1 = frequencyData[i];
          const p2 = frequencyData[i + 1];
          const count = Math.max(p1.count, p2.count);

          const color = getFrequencyColor(count, maxCount);
          const weight = count > 0 ? 7 + Math.min(count, 5) : 5;

          L.polyline(
            [
              [p1.lat, p1.lng],
              [p2.lat, p2.lng],
            ],
            {
              color,
              weight,
              opacity: 0.9,
              lineCap: 'round',
              lineJoin: 'round',
            },
          ).addTo(map);
        }
      }

      // Fit map to bounds
      if (allBounds.length > 0) {
        map.fitBounds(L.latLngBounds(allBounds).pad(0.15));
      }

      cleanup = () => {
        map.remove();
        mapInstanceRef.current = null;
      };
    };

    initMap();

    return () => {
      if (cleanup) cleanup();
    };
  }, [decodedMain, frequencyData]);

  const maxFreq = useMemo(() => {
    if (!frequencyData) return 0;
    return Math.max(...frequencyData.map((d) => d.count), 0);
  }, [frequencyData]);

  return (
    <div className="space-y-3">
      <div
        ref={mapRef}
        className="rounded-lg overflow-hidden"
        style={{ height: '400px', minHeight: '300px' }}
      />

      {/* Frequency legend */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="text-muted font-medium">Ride frequency:</span>
        <div className="flex items-center gap-1">
          <span className="inline-block w-4 h-2 rounded" style={{ backgroundColor: getFrequencyColor(0, maxFreq) }} />
          <span className="text-muted">Never</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="inline-block w-4 h-2 rounded" style={{ backgroundColor: getFrequencyColor(1, maxFreq) }} />
          <span className="text-muted">1×</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="inline-block w-4 h-2 rounded" style={{ backgroundColor: getFrequencyColor(Math.ceil(maxFreq * 0.33), maxFreq) }} />
          <span className="text-muted">Some</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="inline-block w-4 h-2 rounded" style={{ backgroundColor: getFrequencyColor(Math.ceil(maxFreq * 0.66), maxFreq) }} />
          <span className="text-muted">Many</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="inline-block w-4 h-2 rounded" style={{ backgroundColor: getFrequencyColor(maxFreq, maxFreq) }} />
          <span className="text-muted">Most</span>
        </div>
      </div>

      {/* Stats */}
      <div className="text-xs text-muted">
        🚴 {ridden_segments.length} ride{ridden_segments.length !== 1 ? 's' : ''} recorded on this route
      </div>

      {sources.length === 0 && ridden_segments.length === 0 && (
        <p className="text-xs text-muted">
          No source variants or ride history available.
        </p>
      )}
    </div>
  );
}

// Haversine distance helper
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Color gradient: dark purple (rare) → dark blue → dark teal → dark orange → bright red (frequent)
function getFrequencyColor(count: number, maxCount: number): string {
  if (maxCount === 0 || count === 0) return '#cbd5e1'; // slate-300 for unridden
  
  const ratio = Math.min(count / maxCount, 1);
  
  // 5-stop gradient with darker, more saturated colors
  if (ratio < 0.25) {
    // Dark purple to dark blue
    const t = ratio / 0.25;
    return lerpColor('#581c87', '#1e40af', t);
  } else if (ratio < 0.5) {
    // Dark blue to dark teal
    const t = (ratio - 0.25) / 0.25;
    return lerpColor('#1e40af', '#065f46', t);
  } else if (ratio < 0.75) {
    // Dark teal to dark orange
    const t = (ratio - 0.5) / 0.25;
    return lerpColor('#065f46', '#9a3412', t);
  } else {
    // Dark orange to bright red
    const t = (ratio - 0.75) / 0.25;
    return lerpColor('#9a3412', '#dc2626', t);
  }
}

function lerpColor(c1: string, c2: string, t: number): string {
  const r1 = parseInt(c1.slice(1, 3), 16);
  const g1 = parseInt(c1.slice(3, 5), 16);
  const b1 = parseInt(c1.slice(5, 7), 16);
  const r2 = parseInt(c2.slice(1, 3), 16);
  const g2 = parseInt(c2.slice(3, 5), 16);
  const b2 = parseInt(c2.slice(5, 7), 16);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
