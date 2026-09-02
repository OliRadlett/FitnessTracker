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
        zoomControl: true,
        scrollWheelZoom: true,
      });
      mapInstanceRef.current = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      // Heatmap layer: density of activity points around home area
      if (heatmapData && heatmapData.points.length > 0) {
        const { center_lat, center_lng, radius_km, points } = heatmapData;

        // Compute max dynamically from point density
        // Use a grid to count points per cell, then take 90th percentile
        const grid: Record<string, number> = {};
        const cellSize = 0.001; // ~100m cells
        for (const p of points) {
          const key = `${Math.floor(p.lat / cellSize)}_${Math.floor(p.lng / cellSize)}`;
          grid[key] = (grid[key] || 0) + 1;
        }
        const counts = Object.values(grid).sort((a, b) => a - b);
        const p90 = counts[Math.floor(counts.length * 0.9)] || 1;
        const maxIntensity = Math.max(p90 * 1.5, 2);

        // Use leaflet.heat plugin for proper heatmap rendering
        const heatLayer = (L as any).heatLayer(
          points.map((p) => [p.lat, p.lng, 1]),
          {
            radius: 8,
            blur: 12,
            maxZoom: 17,
            max: maxIntensity,
            gradient: {
              0.1: '#1e40af',  // dark blue
              0.25: '#065f46',  // dark teal
              0.4: '#9a3412',  // dark orange
              0.6: '#dc2626',  // bright red
              0.8: '#991b1b',  // dark red
              1.0: '#7f1d1d',  // very dark red
            },
          },
        );
        heatLayer.addTo(map);

        // Draw home area circle
        L.circle(L.latLng(center_lat, center_lng), {
          radius: radius_km * 1000,
          color: '#9a3412',  // dark orange
          weight: 2,
          dashArray: '5, 5',
          fill: false,
        }).addTo(map).bindPopup(
          `<div style="font-size:12px;"><strong>Home Area</strong><br/>${radius_km} km radius · ${points.length} activity points</div>`
        );
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
            iconSize: [20, 20],
            iconAnchor: [10, 10],
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
