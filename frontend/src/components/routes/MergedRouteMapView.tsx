'use client';

import React, { useRef, useEffect, useMemo } from 'react';
import type { MergedRouteView } from '@/lib/api/types';
import { decodePolyline } from '@/lib/polyline';

const SOURCE_COLORS = [
  '#3b82f6',
  '#ef4444',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#14b8a3',
  '#f97316',
];

/**
 * Renders a merged route with each contributing source's polyline drawn
 * separately, plus activity segments overlaid to highlight ridden sections.
 */
export function MergedRouteMapView({
  mergedRoute,
}: {
  mergedRoute: MergedRouteView;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<unknown>(null);

  const { encoded_polyline, sources, ridden_segments } = mergedRoute;

  // Decode all polylines once
  const decodedMain = useMemo(
    () => decodePolyline(encoded_polyline),
    [encoded_polyline],
  );
  const decodedSources = useMemo(
    () =>
      sources.map((s) => ({
        source: s,
        points: decodePolyline(s.encoded_polyline),
      })),
    [sources],
  );
  const decodedSegments = useMemo(
    () =>
      ridden_segments.map((seg) => ({
        points: decodePolyline(seg.encoded_polyline),
      })),
    [ridden_segments],
  );

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

      // Add ridden segments as semi-transparent green overlays
      for (const { points } of decodedSegments) {
        if (points.length < 2) continue;
        const latLngs: [number, number][] = points.map(([lat, lng]) => [lat, lng]);
        allBounds.push(...latLngs);

        L.polyline(latLngs, {
          color: '#22c55e',
          weight: 5,
          opacity: 0.5,
          lineCap: 'round',
        }).addTo(map);
      }

      // Add each source polyline with distinct color
      for (let i = 0; i < decodedSources.length; i++) {
        const { points } = decodedSources[i];
        if (points.length < 2) continue;
        const latLngs: [number, number][] = points.map(([lat, lng]) => [lat, lng]);
        allBounds.push(...latLngs);

        const color = SOURCE_COLORS[i % SOURCE_COLORS.length];

        L.polyline(latLngs, {
          color,
          weight: 4,
          opacity: 0.8,
          lineCap: 'round',
          dashArray: '4, 6',
        }).addTo(map);
      }

      // Draw the canonical merged route as the primary bold line
      if (decodedMain.length > 0) {
        const latLngs: [number, number][] = decodedMain.map(([lat, lng]) => [lat, lng]);
        allBounds.push(...latLngs);

        L.polyline(latLngs, {
          color: '#ffffff',
          weight: 6,
          opacity: 0.7,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(map);
      }

      // Fit map to all bounds
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
  }, [decodedMain, decodedSources, decodedSegments]);

  return (
    <div className="space-y-3">
      <div
        ref={mapRef}
        className="rounded-lg overflow-hidden"
        style={{ height: '400px', minHeight: '300px' }}
      />

      {/* Source legend */}
      {decodedSources.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          {decodedSources.map(({ source }, i) => {
            const color = SOURCE_COLORS[i % SOURCE_COLORS.length];
            const hasPolyline = source.encoded_polyline && source.encoded_polyline.length > 0;
            return (
              <div
                key={source.id}
                className="inline-flex items-center gap-1.5 px-2 py-1 bg-surface-light/30 rounded"
              >
                <span
                  className="inline-block w-3 h-3 rounded-sm"
                  style={{ backgroundColor: color }}
                />
                <span className="text-muted">
                  {source.provider_name || source.provider}
                </span>
                <span className="text-muted">
                  {hasPolyline ? 'polyline ✓' : 'no polyline'}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Ridden segments summary */}
      {decodedSegments.length > 0 && (
        <div className="text-xs text-muted">
          🚴 {decodedSegments.length} ride{decodedSegments.length !== 1 ? 's' : ''} recorded on this route
          {decodedSegments.length > 0 && (
            <span className="ml-2 text-green-400">
              (sections highlighted in green on the map)
            </span>
          )}
        </div>
      )}

      {decodedSources.length === 0 && decodedSegments.length === 0 && (
        <p className="text-xs text-muted">
          No source variants or ride history available.
        </p>
      )}
    </div>
  );
}
