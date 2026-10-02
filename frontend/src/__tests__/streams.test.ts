import { describe, it, expect } from 'vitest';
import {
  ALTITUDE_STREAM_TYPES,
  CADENCE_STREAM_TYPES,
  HEARTRATE_STREAM_TYPES,
  POWER_STREAM_TYPES,
  VELOCITY_STREAM_TYPES,
  getStreamValues,
  hasStream,
  presentStreamTypes,
  replayMissingReason,
  streamInput,
  streamLabel,
} from '@/lib/streams';
import type { ActivityStream } from '@/lib/api';

function stream(type: string, values: number[], resolution = 1): ActivityStream {
  return {
    id: `${type}-id`,
    activity_id: 'activity-id',
    stream_type: type,
    data: { data: values },
    resolution,
  };
}

describe('stream spelling matrix (Strava vs FIT)', () => {
  it('prefers Strava power spelling, falls back to FIT', () => {
    const streams = [stream('power', [1, 2]), stream('watts', [3, 4])];
    expect(getStreamValues(streams, ...POWER_STREAM_TYPES)).toEqual([3, 4]);
    expect(getStreamValues([stream('power', [1, 2])], ...POWER_STREAM_TYPES)).toEqual([1, 2]);
  });

  it('resolves all velocity spellings including FIT enhanced_speed', () => {
    expect(getStreamValues([stream('velocity', [5])], ...VELOCITY_STREAM_TYPES)).toEqual([5]);
    expect(getStreamValues([stream('velocity_smooth', [6])], ...VELOCITY_STREAM_TYPES)).toEqual([6]);
    expect(getStreamValues([stream('enhanced_speed', [7])], ...VELOCITY_STREAM_TYPES)).toEqual([7]);
  });

  it('resolves hr/heart_rate aliases beyond heartrate', () => {
    expect(getStreamValues([stream('hr', [80])], ...HEARTRATE_STREAM_TYPES)).toEqual([80]);
    expect(getStreamValues([stream('heart_rate', [81])], ...HEARTRATE_STREAM_TYPES)).toEqual([81]);
  });

  it('skips empty payloads and falls through to the next spelling', () => {
    const streams = [stream('watts', []), stream('power', [100])];
    expect(getStreamValues(streams, ...POWER_STREAM_TYPES)).toEqual([100]);
    expect(getStreamValues([stream('watts', [])], ...POWER_STREAM_TYPES)).toEqual([]);
  });

  it('returns resolution from the matched stream', () => {
    expect(streamInput([stream('watts', [1], 3)], ...POWER_STREAM_TYPES)).toEqual({
      values: [1],
      resolution: 3,
    });
    expect(streamInput(undefined, ...POWER_STREAM_TYPES)).toBeUndefined();
  });

  it('reports only types that carry data', () => {
    const streams = [stream('watts', [1]), stream('cadence', []), stream('altitude', [2])];
    expect(presentStreamTypes(streams)).toEqual(['watts', 'altitude']);
    expect(presentStreamTypes(undefined)).toEqual([]);
  });

  it('hasStream checks presence without allocating', () => {
    expect(hasStream([stream('cadence', [9])], ...CADENCE_STREAM_TYPES)).toBe(true);
    expect(hasStream([stream('cadence', [])], ...CADENCE_STREAM_TYPES)).toBe(false);
    expect(hasStream(undefined, ...ALTITUDE_STREAM_TYPES)).toBe(false);
  });

  it('labels raw provider spellings for display (0.7)', () => {
    expect(streamLabel('velocity_smooth')).toBe('Speed');
    expect(streamLabel('heartrate')).toBe('Heart rate');
    expect(streamLabel('watts')).toBe('Power');
    expect(streamLabel('time')).toBe('Time');
    expect(streamLabel('mystery_metric')).toBe('Mystery Metric');
  });
});

describe('replayMissingReason', () => {
  it('returns null when not cycling, loading, errored, or streamless', () => {
    const vel = [stream('velocity_smooth', [1])];
    expect(replayMissingReason({ isCycling: false, loading: false, error: false, streams: vel, polyline: 'abc' })).toBeNull();
    expect(replayMissingReason({ isCycling: true, loading: true, error: false, streams: vel, polyline: 'abc' })).toBeNull();
    expect(replayMissingReason({ isCycling: true, loading: false, error: true, streams: vel, polyline: 'abc' })).toBeNull();
    expect(replayMissingReason({ isCycling: true, loading: false, error: false, streams: [], polyline: 'abc' })).toBeNull();
    expect(replayMissingReason({ isCycling: true, loading: false, error: false, streams: undefined, polyline: 'abc' })).toBeNull();
  });

  it('explains missing GPS before missing speed', () => {
    expect(
      replayMissingReason({ isCycling: true, loading: false, error: false, streams: [stream('power', [1])], polyline: null })
    ).toBe('No route attached — 3D replay needs GPS.');
  });

  it('names present streams with human labels, never raw spellings', () => {
    const msg = replayMissingReason({
      isCycling: true,
      loading: false,
      error: false,
      streams: [stream('heartrate', [60]), stream('watts', [100])],
      polyline: 'abc',
    });
    expect(msg).toBe('3D replay needs a speed stream — this ride has Heart rate, Power but no velocity.');
  });

  it('returns null when a speed stream exists', () => {
    expect(
      replayMissingReason({ isCycling: true, loading: false, error: false, streams: [stream('enhanced_speed', [5])], polyline: 'abc' })
    ).toBeNull();
  });
});
