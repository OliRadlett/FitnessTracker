// Shared Leaflet basemap (0.10).
//
// CARTO's basemaps.cartocdn.com now serves "API KEY REQUIRED" watermark tiles
// without a key, so the default is keyless OSM Standard. Point
// NEXT_PUBLIC_MAP_TILES (+ optionally NEXT_PUBLIC_MAP_ATTRIBUTION) at a keyed
// dark provider (MapTiler / JawG / CARTO) to restore a dark basemap without
// code changes.

export const MAP_TILE_URL =
  process.env.NEXT_PUBLIC_MAP_TILES ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export const MAP_ATTRIBUTION =
  process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ??
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export const MAP_MAX_ZOOM = 19;
