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
