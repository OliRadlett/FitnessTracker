/**
 * Polyline styling for the two-route comparison overlay.
 *
 * Extracted from `CompareRoutesMap` so it can be tested without Leaflet: the
 * component imports Leaflet dynamically and needs a real DOM, so the rule
 * that matters — *both traces must stay visible when they coincide* — was
 * untestable where it lived.
 *
 * That rule was broken. B drew underneath A at weight 4 against A's weight 3,
 * so for byte-identical polylines the amber line was covered by blue with a
 * ~1 px fringe. The most common case in the duplicate queue — two recordings
 * of the same ride, same geometry — therefore looked like B was missing
 * entirely.
 *
 * The fix is a width delta wide enough to survive overlap. B stays
 * underneath so A's shape reads clearly on top, but B is fat enough that its
 * edges remain visible when they coincide.
 */

export const COLOR_A = '#3b82f6'; // blue, dashed, on top
export const COLOR_B = '#f59e0b'; // amber, solid, underneath

/** Below this a "polyline" is a start and an end, not a shape worth drawing. */
export const MIN_DRAWABLE_POINTS = 3;

export interface PolylineStyle {
  color: string;
  weight: number;
  opacity: number;
  dashArray?: string;
}

/**
 * Styles for the two overlays.
 *
 * The A/B weight gap is the load-bearing number: it must be large enough that
 * B is still visible when the two paths are identical, which is the default
 * for a genuine duplicate.
 */
export function overlayStyles(): { a: PolylineStyle; b: PolylineStyle } {
  return {
    b: { color: COLOR_B, weight: 7, opacity: 0.45 },
    a: { color: COLOR_A, weight: 3, opacity: 0.95, dashArray: '7 5' },
  };
}

/**
 * Whether a trace has enough points to be worth drawing.
 *
 * Four production routes decode to 2–31 points — an `Evening Ride` recorded
 * as 1202 m with **2** points renders as a single straight line, which reads
 * as an empty map. Distinguishing "no data" from "too sparse to draw" is
 * honest; silently drawing a two-pixel line is not.
 */
export function isDrawable(points: unknown[] | null | undefined): boolean {
  return Array.isArray(points) && points.length >= MIN_DRAWABLE_POINTS;
}