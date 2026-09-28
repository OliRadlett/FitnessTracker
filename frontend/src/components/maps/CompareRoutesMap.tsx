'use client';

import { useEffect, useMemo, useRef } from 'react';
import { decodePolyline } from '@/lib/polyline';
import { MAP_ATTRIBUTION, MAP_MAX_ZOOM, MAP_TILE_URL } from '@/lib/mapTiles';

interface CompareRoutesMapProps {
  encodedA: string;
  encodedB: string;
  /** Optional legend labels (e.g. route names). */
  labelA?: string;
  labelB?: string;
  className?: string;
}

// A = existing/accent blue, B = amber. High-contrast over OSM tiles.
const COLOR_A = '#3b82f6';
const COLOR_B = '#f59e0b';

/**
 * Overlay map for the duplicate-review queue: draws both candidate polylines on
 * one Leaflet map so it is immediately obvious whether they follow the same
 * roads. Zoom/pan are shared, which is what makes judgement possible — two
 * separate maps fitted independently can look identical when they are not.
 *
 * `RouteMap` renders a single route; this is the two-route comparison case.
 */
export function CompareRoutesMap({
  encodedA,
  encodedB,
  labelA = 'A',
  labelB = 'B',
  className = '',
}: CompareRoutesMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<unknown>(null);

  const pointsA = useMemo(() => decodePolyline(encodedA), [encodedA]);
  const pointsB = useMemo(() => decodePolyline(encodedB), [encodedB]);

  useEffect(() => {
    if (!mapRef.current) return;
    if (pointsA.length === 0 && pointsB.length === 0) return;

    let cleanup: (() => void) | undefined;

    const initMap = async () => {
      const L = (await import('leaflet')).default;

      if (mapInstanceRef.current) {
        (mapInstanceRef.current as { remove: () => void }).remove();
        mapInstanceRef.current = null;
      }

      const map = L.map(mapRef.current!, {
        zoomControl: false,
        scrollWheelZoom: false,
        tapTolerance: 30,
        attributionControl: true,
      });
      mapInstanceRef.current = map;

      L.tileLayer(MAP_TILE_URL, {
        attribution: MAP_ATTRIBUTION,
        maxZoom: MAP_MAX_ZOOM,
      }).addTo(map);

      const latLngsA = pointsA.map((p) => L.latLng(p[0], p[1]));
      const latLngsB = pointsB.map((p) => L.latLng(p[0], p[1]));

      // B first (under), then A (over) so A reads clearly where they overlap.
      if (latLngsB.length > 1) {
        L.polyline(latLngsB, {
          color: COLOR_B,
          weight: 4,
          opacity: 0.75,
        }).addTo(map);
      }
      if (latLngsA.length > 1) {
        L.polyline(latLngsA, {
          color: COLOR_A,
          weight: 3,
          opacity: 0.85,
          dashArray: '6 4',
        }).addTo(map);
      }

      // Start markers: A solid, B hollow, so overlapping starts stay readable.
      const dot = (color: string) =>
        L.divIcon({
          html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.4)"></div>`,
          className: '',
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        });
      if (latLngsA.length > 0) L.marker(latLngsA[0], { icon: dot(COLOR_A) }).addTo(map);
      if (latLngsB.length > 0) L.marker(latLngsB[0], { icon: dot(COLOR_B) }).addTo(map);

      const all = [...latLngsA, ...latLngsB];
      if (all.length > 0) {
        map.fitBounds(L.latLngBounds(all), { padding: [16, 16] });
      }

      // Nudge an invalidateSize after layout settles (modal/drawer animations).
      const t = setTimeout(() => map.invalidateSize(), 150);
      cleanup = () => {
        clearTimeout(t);
        map.remove();
        mapInstanceRef.current = null;
      };
    };

    void initMap();
    return () => cleanup?.();
  }, [pointsA, pointsB]);

  if (pointsA.length === 0 && pointsB.length === 0) {
    return (
      <div className={`flex items-center justify-center bg-surface-light/20 rounded-lg ${className}`}>
        <p className="text-muted text-sm">No route data available</p>
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        ref={mapRef}
        className={`rounded-lg overflow-hidden ${className}`}
        style={{ minHeight: '240px' }}
      />
      <div className="absolute top-2 left-2 z-[400] flex flex-col gap-1 rounded bg-background/85 px-2 py-1 text-xs backdrop-blur">
        <span className="flex items-center gap-1.5 text-foreground">
          <span
            className="inline-block h-2 w-4 rounded-sm"
            style={{ background: COLOR_A }}
          />
          A · {labelA}
        </span>
        <span className="flex items-center gap-1.5 text-foreground">
          <span
            className="inline-block h-2 w-4 rounded-sm"
            style={{ background: COLOR_B }}
          />
          B · {labelB}
        </span>
      </div>
    </div>
  );
}
