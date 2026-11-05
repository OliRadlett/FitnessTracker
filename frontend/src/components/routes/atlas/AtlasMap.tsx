'use client';

import { useEffect, useRef, useState } from 'react';
import type { LayerGroup, Map as LeafletMap, Path } from 'leaflet';
import type { RouteSummary } from '@/lib/api/types';
import { decodePolyline, hasShape, haversineKm } from '@/lib/routeAtlas';

const BASE_COLOR = '#a9bccd';
const RIDDEN_COLOR = '#7f93a6';
const HOVER_COLOR = '#a7f3d0';
const SELECT_COLOR = '#34d399';
const COMPARE_COLOR = '#fbbf24';

export interface HeatPoint {
  lat: number;
  lng: number;
}

/**
 * Map of the library: every route is a line, not a pin. Selection/hover dims
 * the rest so a dense city cluster still reads as individual shapes.
 */
export function AtlasMap({
  routes,
  hub,
  selectedId,
  hoveredId,
  compareIds,
  compareMode,
  heatmapPoints,
  onSelect,
  onHover,
  onCompare,
}: {
  routes: RouteSummary[];
  hub: { lat: number; lng: number; count: number } | null;
  selectedId: string | null;
  hoveredId: string | null;
  compareIds: string[];
  compareMode: boolean;
  heatmapPoints?: HeatPoint[];
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
  onCompare: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerGroupRef = useRef<LayerGroup | null>(null);
  const heatLayerRef = useRef<unknown>(null);
  const layersRef = useRef<Map<string, Path>>(new Map());
  const didInitialFitRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [drawVersion, setDrawVersion] = useState(0);

  // Init once. Leaflet is imported lazily so the page still SSRs.
  useEffect(() => {
    let cancelled = false;
    let map: LeafletMap | null = null;

    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !containerRef.current) return;

      map = L.map(containerRef.current, {
        zoomControl: false,
        scrollWheelZoom: false,
        tapTolerance: 24,
        zoomSnap: 0.25,
      });
      mapRef.current = map;

      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);

      // Dark canvas without a keyed tile vendor: OSM has no keyless dark
      // variant, so invert the tile pane. Roads stay legible and the route
      // lines remain the brightest thing on the map.
      const tiles = map.getPane('tilePane');
      if (tiles) tiles.style.filter = 'grayscale(1) invert(1) brightness(0.62) contrast(0.92)';

      map.attributionControl.setPrefix(false);
      L.control.zoom({ position: 'topright' }).addTo(map);
      layerGroupRef.current = L.layerGroup().addTo(map);

      const style = document.createElement('style');
      style.id = 'atlas-tooltip-style';
      style.textContent =
        '.atlas-tooltip{background:#0b1115;border:1px solid rgba(148,163,184,.25);' +
        'color:#e6e6e6;font-size:11px;padding:4px 8px;border-radius:6px;' +
        'box-shadow:0 4px 14px rgba(0,0,0,.5)}' +
        '.atlas-tooltip::before{border-top-color:rgba(148,163,184,.25)!important}' +
        '.atlas-map .leaflet-control-attribution{background:rgba(11,17,21,.7);color:#64748b;font-size:9px}' +
        '.atlas-map .leaflet-control-attribution a{color:#64748b}' +
        '.atlas-map .leaflet-bar a{background:#111a1f;color:#cbd5e1;border-color:#1e2a2a}' +
        '.atlas-map .leaflet-bar a:hover{background:#1a2529;color:#fff}';
      document.head.appendChild(style);

      map.on('click', () => onSelect(null));
      map.setView([55.5, -3.5], 6);
      setReady(true);
    })();

    return () => {
      cancelled = true;
      layersRef.current.clear();
      layerGroupRef.current = null;
      if (map) map.remove();
      mapRef.current = null;
      document.getElementById('atlas-tooltip-style')?.remove();
    };
    // onSelect is read once; the handler only clears selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Draw the current set.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    (async () => {
      const L = (await import('leaflet')).default;
      const map = mapRef.current;
      const group = layerGroupRef.current;
      if (cancelled || !map || !group) return;

      group.clearLayers();
      layersRef.current.clear();
      const allPoints: [number, number][] = [];

      for (const route of routes) {
        const coords = hasShape(route) ? decodePolyline(route.preview_polyline) : [];
        if (coords.length >= 2) {
          const line = L.polyline(coords as [number, number][], {
            color: route.is_ridden ? RIDDEN_COLOR : BASE_COLOR,
            weight: 3,
            opacity: route.is_ridden ? 0.55 : 0.85,
            lineJoin: 'round',
            lineCap: 'round',
            interactive: true,
          });
          line.bindTooltip(route.name, {
            sticky: true,
            direction: 'top',
            className: 'atlas-tooltip',
            opacity: 1,
          });
          line.on('mouseover', () => onHover(route.id));
          line.on('mouseout', () => onHover(null));
          line.on('click', (event) => {
            L.DomEvent.stopPropagation(event);
            if (compareMode) onCompare(route.id);
            else onSelect(route.id);
          });
          line.addTo(group);
          layersRef.current.set(route.id, line);
          allPoints.push(...(coords as [number, number][]));
        } else {
          const dot = L.circleMarker([route.start_lat, route.start_lng], {
            radius: 4,
            color: '#94a3b8',
            weight: 1,
            fillColor: '#94a3b8',
            fillOpacity: 0.5,
          });
          dot.bindTooltip(`${route.name} — no shape data`, { className: 'atlas-tooltip' });
          dot.on('click', (event) => {
            L.DomEvent.stopPropagation(event);
            if (compareMode) onCompare(route.id);
            else onSelect(route.id);
          });
          dot.addTo(group);
          layersRef.current.set(route.id, dot);
          allPoints.push([route.start_lat, route.start_lng]);
        }
      }

      if (allPoints.length > 0 && !didInitialFitRef.current) {
        // First look = the dense start cluster, so shapes are legible. Filter
        // changes do not refit; lines appear/disappear in place.
        const initial = hub && hub.count >= 5;
        const fitPoints = initial
          ? routes
              .filter((r) => haversineKm(hub!.lat, hub!.lng, r.start_lat, r.start_lng) <= 80)
              .flatMap((r) =>
                hasShape(r)
                  ? decodePolyline(r.preview_polyline)
                  : ([[r.start_lat, r.start_lng]] as [number, number][]),
              )
          : allPoints;
        didInitialFitRef.current = true;
        map.fitBounds(L.latLngBounds(fitPoints.length ? fitPoints : allPoints).pad(0.1), {
          animate: false,
        });
      }
      setDrawVersion((version) => version + 1);
    })();

    return () => {
      cancelled = true;
    };
  }, [routes, ready, onHover, onSelect, onCompare, compareMode, hub]);

  // Selection / hover / compare styling.
  useEffect(() => {
    const focusId = selectedId ?? hoveredId;
    const compared = new Set(compareIds);
    for (const [id, layer] of layersRef.current) {
      const isSelected = id === selectedId;
      const isHovered = id === hoveredId;
      const isCompared = compared.has(id);
      if (isSelected) {
        layer.setStyle({ color: SELECT_COLOR, weight: 4.5, opacity: 1 });
        layer.bringToFront();
      } else if (isCompared) {
        layer.setStyle({ color: COMPARE_COLOR, weight: 4.5, opacity: 1 });
        layer.bringToFront();
      } else if (isHovered) {
        layer.setStyle({ color: HOVER_COLOR, weight: 4, opacity: 1 });
        layer.bringToFront();
      } else if (focusId) {
        layer.setStyle({ color: BASE_COLOR, weight: 2, opacity: 0.14 });
      } else {
        const route = routes.find((r) => r.id === id);
        layer.setStyle({
          color: route?.is_ridden ? RIDDEN_COLOR : BASE_COLOR,
          weight: 3,
          opacity: route?.is_ridden ? 0.55 : 0.85,
        });
      }
    }
  }, [selectedId, hoveredId, routes, compareIds, drawVersion]);

  // Heatmap of where the user actually rides (optional overlay).
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    (async () => {
      const L = (await import('leaflet')).default;
      await import('leaflet.heat');
      const map = mapRef.current;
      if (cancelled || !map) return;

      if (heatLayerRef.current) {
        map.removeLayer(heatLayerRef.current as never);
        heatLayerRef.current = null;
      }
      if (!heatmapPoints || heatmapPoints.length === 0) return;

      // Density-aware weighting: frequent cells must not drown rare roads.
      const cellSize = 0.0005;
      const grid: Record<string, number> = {};
      for (const p of heatmapPoints) {
        const key = `${Math.floor(p.lat / cellSize)}_${Math.floor(p.lng / cellSize)}`;
        grid[key] = (grid[key] || 0) + 1;
      }
      const counts = Object.values(grid).sort((a, b) => a - b);
      const p50 = counts[Math.floor(counts.length * 0.5)] || 1;
      const p75 = counts[Math.floor(counts.length * 0.75)] || p50;
      const maxIntensity = Math.max(Math.sqrt(p50) * 4.2, Math.sqrt(p75) * 2.6, 2.5);
      const weighted: [number, number, number][] = heatmapPoints.map((p) => {
        const key = `${Math.floor(p.lat / cellSize)}_${Math.floor(p.lng / cellSize)}`;
        const count = grid[key] || 1;
        return [p.lat, p.lng, 1 / Math.sqrt(count)];
      });

      const heat = (L as unknown as { heatLayer: (p: unknown, o: unknown) => { addTo: (m: unknown) => void } })
        .heatLayer(weighted, {
          radius: 6,
          blur: 8,
          minOpacity: 0.5,
          maxZoom: 17,
          max: maxIntensity,
          gradient: {
            0.0: 'rgba(0,0,0,0)',
            0.25: '#3b82f6',
            0.45: '#06b6d4',
            0.6: '#f59e0b',
            0.8: '#ef4444',
            1.0: '#7f1d1d',
          },
        });
      heat.addTo(map);
      heatLayerRef.current = heat;
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, heatmapPoints]);

  const fitAll = async () => {
    const map = mapRef.current;
    if (!map) return;
    const L = (await import('leaflet')).default;
    const points = routes.flatMap((r) =>
      hasShape(r)
        ? decodePolyline(r.preview_polyline)
        : [[r.start_lat, r.start_lng] as [number, number]],
    );
    if (points.length) {
      map.flyToBounds(L.latLngBounds(points as [number, number][]).pad(0.08), { duration: 0.5 });
    }
  };

  const empty = routes.length === 0;

  return (
    <div className="relative isolate h-full w-full overflow-hidden rounded-xl border border-surface-light/60 bg-[#0b1014]">
      <div ref={containerRef} className="atlas-map h-full w-full" aria-label="Map of your routes" />

      {empty && (
        <div className="pointer-events-none absolute inset-0 z-[450] flex items-center justify-center bg-background/60">
          <p className="text-sm text-muted">No routes match these filters</p>
        </div>
      )}

      <button
        type="button"
        onClick={fitAll}
        className="absolute left-3 top-3 z-[500] rounded-lg border border-surface-light/70 bg-background/85 px-3 py-1.5 text-xs font-medium text-foreground backdrop-blur transition-colors hover:bg-surface"
      >
        Fit all
      </button>

      {compareMode && (
        <div className="pointer-events-none absolute bottom-3 left-3 z-[500] rounded-md bg-background/85 px-2 py-1 text-[11px] text-amber-300">
          Compare mode — pick two routes
        </div>
      )}
    </div>
  );
}
