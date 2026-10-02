/**
 * Tour sequencing helpers for the Relive auto-tour (next-level Phase B).
 *
 * Highlights and story beats are detected independently but the tour presents
 * one timeline — this module answers "what comes next" across both lists so
 * the viewer can look ahead ("Up next: Climb · in 2:35"). Pure — unit-tested.
 */

/** Minimal shape shared by highlights and beats for sequencing. */
export interface TourEvent {
  startElapsed: number;
  label: string;
  startKm: number;
}

export interface NextEvent<T extends TourEvent> {
  event: T;
  /** seconds from `elapsed` to the event start */
  inSeconds: number;
}

/**
 * Nearest event starting strictly after `elapsed` within `horizonS`.
 * Past-the-end and beyond-horizon both yield null (the tour simply has
 * nothing queued). Ties break toward the earlier list order — callers pass
 * highlights first so terrain wins over story on identical timestamps.
 */
export function nextEvent<T extends TourEvent>(
  events: readonly T[],
  elapsed: number,
  horizonS = 180
): NextEvent<T> | null {
  if (!(horizonS > 0)) return null;
  let best: NextEvent<T> | null = null;
  for (const event of events) {
    const inSeconds = event.startElapsed - elapsed;
    if (inSeconds <= 0 || inSeconds > horizonS) continue;
    if (!best || inSeconds < best.inSeconds) best = { event, inSeconds };
  }
  return best;
}
