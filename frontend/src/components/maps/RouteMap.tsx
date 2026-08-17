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

      // Create map
      const map = L.map(mapRef.current!, {
        zoomControl: true,
        scrollWheelZoom: true,
      });
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

      // Add start marker
      const startIcon = L.divIcon({
        html: '<div style="background:#22c55e;width:12px;height:12px;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div>',
        className: '',
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      });
      L.marker(latLngs[0], { icon: startIcon }).addTo(map);

      // Add end marker (or loop indicator)
      if (!isLoop && latLngs.length > 1) {
        const endIcon = L.divIcon({
          html: '<div style="background:#ef4444;width:12px;height:12px;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div>',
          className: '',
          iconSize: [12, 12],
          iconAnchor: [6, 6],
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
