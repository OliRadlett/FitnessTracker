'use client';

import { useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { RouteSummary, HomeAreaHeatmapResponse } from '@/lib/api/types';
import { useAuthFetch } from '@/lib/api';
import { getHomeAreaHeatmap } from '@/lib/api/routes';
import { formatDistance } from '@/lib/utils';
import { computeDifficulty, fmtElevation } from '@/lib/routeUtils';
import { useRoutesStore } from '@/lib/stores/routesStore';

export function RoutesMapView({
  routes,
  onSelectRoute,
  showHeatmap = false,
}: {
  routes: RouteSummary[];
  onSelectRoute: (id: string) => void;
  showHeatmap?: boolean;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<unknown>(null);
  const { selectedRouteId } = useRoutesStore();
  const { token } = useAuthFetch();

  // Fetch home area heatmap data
  const { data: heatmapData } = useQuery<HomeAreaHeatmapResponse>({
    queryKey: ['home-area-heatmap', showHeatmap],
    queryFn: () => getHomeAreaHeatmap(token),
    enabled: !!token && showHeatmap,
    staleTime: 300_000,
    retry: false,
  });

  useEffect(() => {
    if (!mapRef.current || routes.length === 0) return;

    let cleanup: (() => void) | undefined;

    const initMap = async () => {
      const L = (await import('leaflet')).default;
      await import('leaflet.heat');

      if (mapInstanceRef.current) {
        (mapInstanceRef.current as { remove: () => void }).remove();
        mapInstanceRef.current = null;
      }

      const map = L.map(mapRef.current!, {
        zoomControl: false,
        scrollWheelZoom: false,
        tapTolerance: 30,
      });
      L.control.zoom({ position: 'bottomright' }).addTo(map);
      mapInstanceRef.current = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      // Heatmap layer: activity density — compressed so frequent routes don't drown out rare ones
      if (heatmapData && heatmapData.points.length > 0) {
        const { points } = heatmapData;

        // Count points per ~55 m grid cell for density-aware weighting
        const cellSize = 0.0005;
        const grid: Record<string, number> = {};
        for (const p of points) {
          const key = `${Math.floor(p.lat / cellSize)}_${Math.floor(p.lng / cellSize)}`;
          grid[key] = (grid[key] || 0) + 1;
        }
        const counts = Object.values(grid).sort((a, b) => a - b);
        // Use sqrt-compressed percentiles so hotspots don't saturate.
        // Prod: cell 0.0005 → p50=1 p75=4 p95=18 max=444. Old linear max=15 → 30×.
        // Tuned via demo: 5.0/3.0 @ 5/7 was too faint (p95 0.71). 4.2/2.6 @ 6/8 is balanced — med 0.22, p95 0.92.
        const p50 = counts[Math.floor(counts.length * 0.5)] || 1;
        const p75 = counts[Math.floor(counts.length * 0.75)] || p50;
        // sqrt dampening: a cell with N pts contributes sqrt(N), not N
        const maxIntensity = Math.max(Math.sqrt(p50) * 4.2, Math.sqrt(p75) * 2.6, 2.5);

        // Weight each point inversely to sqrt(local density) so dense cells
        // don't accumulate linearly.  Resulting per-cell intensity ~= sqrt(count).
        const weightedPoints: [number, number, number][] = points.map((p) => {
          const key = `${Math.floor(p.lat / cellSize)}_${Math.floor(p.lng / cellSize)}`;
          const count = grid[key] || 1;
          const w = 1 / Math.sqrt(count);
          return [p.lat, p.lng, w];
        });

        const heatLayer = (L as any).heatLayer(weightedPoints, {
          radius: 6,
          blur: 8,
          minOpacity: 0.5,
          maxZoom: 17,
          max: maxIntensity,
          gradient: {
            0.0: 'rgba(0,0,0,0)',
            0.25: '#3b82f6', // blue — sparse rides visible but not dominant
            0.45: '#06b6d4', // cyan
            0.6: '#f59e0b', // amber
            0.8: '#ef4444', // red — only repeated segments
            1.0: '#7f1d1d', // very dark red — densest overlaps
          },
        });
        heatLayer.addTo(map);
      }

      const allBounds: [number, number][] = [];

      for (const route of routes) {
        const latLng: [number, number] = [route.start_lat, route.start_lng];
        allBounds.push(latLng);

        const diff = computeDifficulty(route.elevation_gain_meters, route.distance_meters);
        const diffLabel = diff ? ` · ${diff}` : '';

        // Create custom marker with quality score badge
        const markerEl = document.createElement('div');
        markerEl.className = 'route-marker';
        const isSelected = selectedRouteId === route.id;

        let qualityHtml = '';
        if (route.quality_score != null) {
          const qualityColor = route.quality_score >= 70
            ? '#22c55e'
            : route.quality_score >= 50
            ? '#3b82f6'
            : route.quality_score >= 30
            ? '#f59e0b'
            : '#ef4444';
          qualityHtml = `<span style="background:${qualityColor}" class="quality-badge">${Math.round(route.quality_score)}</span>`;
        }

        markerEl.innerHTML = `
          <div class="relative" style="width: 12px; height: 12px;">
            <div class="absolute -top-2 -left-2 -right-2 -bottom-2 rounded-full bg-white border-2 shadow-lg flex items-center justify-center"
                 style="border-color: ${isSelected ? '#38bdfa' : '#64748b'}; width: 16px; height: 16px;">
              <div style="width: 8px; height: 8px; border-radius: 50%; background: ${isSelected ? '#38bdfa' : '#64748b'};"></div>
            </div>
            ${qualityHtml}
          </div>
        `;

        const marker = L.marker(latLng, {
          icon: L.divIcon({
            html: markerEl.outerHTML,
            className: 'route-marker-icon',
            // 28px hit area around the 16px visual
            iconSize: [28, 28],
            iconAnchor: [14, 14],
          }),
        }).addTo(map);

        marker.bindPopup(
          `<div style="min-width:200px; font-size:13px;">` +
            `<div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">` +
              `<strong>${route.name}</strong>` +
              `${route.is_favorite ? ' ★' : ''}` +
              `${qualityHtml ? `<span style="margin-left:auto;font-size:10px;background:${route.quality_score! >= 70 ? '#22c55e' : '#64748b'};color:white;padding:1px 4px;border-radius:3px;">${Math.round(route.quality_score!)}</span>` : ''}` +
            `</div>` +
            `<span style="color:#94a3b8;font-size:12px">` +
              `${formatDistance(route.distance_meters)}` +
              `${route.elevation_gain_meters ? ' · ' + fmtElevation(route.elevation_gain_meters) : ''}` +
              `${diffLabel}` +
            `</span><br/>` +
            `<span style="color:#64748b;font-size:11px">${route.is_loop ? '🔄 Loop' : '➡️ Point-to-point'}</span>` +
            `${route.last_ridden_date ? `<br/><span style="color:#fbbf24;font-size:11px">🚴 ${new Date(route.last_ridden_date).toLocaleDateString()}</span>` : ''}` +
          `</div>`,
        );

        marker.on('click', () => {
          onSelectRoute(route.id);
        });
      }

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
  }, [routes, onSelectRoute, selectedRouteId, showHeatmap, heatmapData]);

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
