'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { decodePolyline } from '@/lib/polyline';

interface RouteMapProps {
  encodedPolyline: string;
  className?: string;
  startLabel?: string;
  endLabel?: string;
  isLoop?: boolean;
  onHover?: (index: number | null) => void;
}

/**
 * Interactive map component that renders a route polyline using Leaflet.
 * Uses dynamic import to avoid SSR issues with Leaflet's window dependency.
 */
export function RouteMap({
  encodedPolyline,
  className = '',
  isLoop = false,
}: RouteMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<unknown>(null);

  const points = useMemo(() => decodePolyline(encodedPolyline), [encodedPolyline]);

  useEffect(() => {
    if (!mapRef.current || points.length === 0) return;

    // Dynamic import to avoid SSR issues
    let cleanup: (() => void) | undefined;

    const initMap = async () => {
      const L = (await import('leaflet')).default;

      // Clean up existing map
      if (mapInstanceRef.current) {
        (mapInstanceRef.current as { remove: () => void }).remove();
        mapInstanceRef.current = null;
      }

      // Create map: wheel-zoom off (fights page scroll), zoom control moved
      // to bottom-right (away from the hamburger), generous tap tolerance
      const map = L.map(mapRef.current!, {
        zoomControl: false,
        scrollWheelZoom: false,
        tapTolerance: 30,
      });
      L.control.zoom({ position: 'bottomright' }).addTo(map);
      mapInstanceRef.current = map;

      // Add OpenStreetMap tiles
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      // Convert points to Leaflet format [lat, lng]
      const latLngs: [number, number][] = points.map(([lat, lng]) => [lat, lng]);

      // Add route polyline
      const polyline = L.polyline(latLngs, {
        color: '#3b82f6',
        weight: 4,
        opacity: 0.8,
      }).addTo(map);

      // Add start marker — 12px visual dot inside a 28px touch target
      const startIcon = L.divIcon({
        html: '<div style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;background:transparent;"><div style="background:#22c55e;width:12px;height:12px;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div></div>',
        className: '',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });
      L.marker(latLngs[0], { icon: startIcon }).addTo(map);

      // Add end marker (or loop indicator)
      if (!isLoop && latLngs.length > 1) {
        const endIcon = L.divIcon({
          html: '<div style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;background:transparent;"><div style="background:#ef4444;width:12px;height:12px;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div></div>',
          className: '',
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });
        L.marker(latLngs[latLngs.length - 1], { icon: endIcon }).addTo(map);
      }

      // Fit map to route bounds
      map.fitBounds(polyline.getBounds().pad(0.1));

      cleanup = () => {
        map.remove();
        mapInstanceRef.current = null;
      };
    };

    initMap();

    return () => {
      if (cleanup) cleanup();
    };
  }, [points, isLoop]);

  if (points.length === 0) {
    return (
      <div className={`flex items-center justify-center bg-surface-light/20 rounded-lg ${className}`}>
        <p className="text-muted text-sm">No route data available</p>
      </div>
    );
  }

  return (
    <div
      ref={mapRef}
      className={`rounded-lg overflow-hidden ${className}`}
      style={{ minHeight: '300px' }}
    />
  );
}
