'use client';

import { useRef, useEffect } from 'react';
import type { RouteSummary } from '@/lib/api';
import { formatDistance } from '@/lib/utils';

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtElevation(meters: number): string {
  return `${Math.round(meters)} m`;
}

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

// ── Map Browse View ──────────────────────────────────────────────────────────

export function MapBrowseView({
  routes,
  onSelectRoute,
}: {
  routes: RouteSummary[];
  onSelectRoute: (id: string) => void;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<unknown>(null);

  useEffect(() => {
    if (!mapRef.current || routes.length === 0) return;

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

      for (const route of routes) {
        const latLng: [number, number] = [route.start_lat, route.start_lng];
        allBounds.push(latLng);

        const diff = computeDifficulty(route.elevation_gain_meters, route.distance_meters);
        const diffLabel = diff ? ` \u00B7 ${diff}` : '';

        const marker = L.marker(latLng).addTo(map);
        marker.bindPopup(
          `<div style="min-width:180px">` +
            `<strong style="font-size:13px">${route.name}</strong><br/>` +
            `<span style="font-size:12px;color:#94a3b8">` +
              `${formatDistance(route.distance_meters)}` +
              `${route.elevation_gain_meters ? ' \u00B7 ' + fmtElevation(route.elevation_gain_meters) : ''}` +
              `${diffLabel}` +
            `</span><br/>` +
            `<span style="font-size:11px;color:#64748b">${route.is_loop ? '\uD83D\uDD04 Loop' : '\u27A1\uFE0F Point-to-point'}</span>` +
          `</div>`,
        );

        marker.on('click', () => {
          onSelectRoute(route.id);
        });
      }

      if (allBounds.length > 0) {
        map.fitBounds(L.latLngBounds(allBounds).pad(0.1));
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
  }, [routes, onSelectRoute]);

  if (routes.length === 0) {
    return (
      <div className="flex items-center justify-center h-[500px] bg-surface-light/20 rounded-lg">
        <p className="text-muted">No routes to display on map</p>
      </div>
    );
  }

  return (
    <div
      ref={mapRef}
      className="rounded-lg overflow-hidden"
      style={{ height: '500px', minHeight: '400px' }}
    />
  );
}
