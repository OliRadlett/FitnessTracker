// Shared activity-stream accessors — the single spelling matrix for
// Strava (`watts`/`velocity_smooth`) vs FIT imports (`power`/`velocity`/
// `enhanced_speed`). All cycling UI must go through these helpers instead of
// per-file `streams.find(...)` fallbacks (bulletproof-streams P2-1).
import type { ActivityStream } from '@/lib/api';

// Ordered by preference: provider-native spelling first.
export const POWER_STREAM_TYPES = ['watts', 'power'];
export const VELOCITY_STREAM_TYPES = ['velocity', 'velocity_smooth', 'enhanced_speed'];
export const HEARTRATE_STREAM_TYPES = ['heartrate', 'hr', 'heart_rate'];
export const ALTITUDE_STREAM_TYPES = ['altitude'];
export const CADENCE_STREAM_TYPES = ['cadence'];

export interface StreamInput {
  values: number[];
  resolution: number;
}

function streamDataValues(stream: ActivityStream): number[] | undefined {
  const data = stream.data as Record<string, unknown> | undefined;
  const values = data?.data as number[] | undefined;
  return values && values.length > 0 ? values : undefined;
}

/** First non-empty stream payload for any of the given types, or undefined. */
export function streamInput(
  streams: ActivityStream[] | undefined,
  ...types: string[]
): StreamInput | undefined {
  if (!streams) return undefined;
  for (const type of types) {
    const s = streams.find((x) => x.stream_type === type);
    if (!s) continue;
    const values = streamDataValues(s);
    if (values) return { values, resolution: s.resolution ?? 1 };
  }
  return undefined;
}

/** Raw values array for the first matching non-empty stream, or []. */
export function getStreamValues(
  streams: ActivityStream[] | undefined,
  ...types: string[]
): number[] {
  return streamInput(streams, ...types)?.values ?? [];
}

/** Stream types that actually carry data (for "why no 3D" messages). */
export function presentStreamTypes(streams: ActivityStream[] | undefined): string[] {
  if (!streams) return [];
  return streams.filter((s) => streamDataValues(s) !== undefined).map((s) => s.stream_type);
}

/** True when any of the given types has a non-empty payload. */
export function hasStream(streams: ActivityStream[] | undefined, ...types: string[]): boolean {
  return streamInput(streams, ...types) !== undefined;
}
