import { describe, expect, it } from 'vitest';
import {
  barPoint,
  frameIndexAt,
  letterbox,
  parsePoseTrack,
  type PoseTrack,
} from '@/lib/pose/track';

function lm(x: number, y: number): [number, number, number] {
  return [x, y, 1];
}

function frameAt(t: number, pts: [number, number, number][]): PoseTrack['frames'][number] {
  return { t, lm: pts, w: null };
}

describe('parsePoseTrack', () => {
  it('parses a valid payload', () => {
    const raw = JSON.stringify({
      version: 1,
      fps: 10,
      exercise: 'Back Squat',
      frames: [{ t: 0.1, lm: [lm(0.5, 0.5)], w: null }],
      reps: [{ rep_number: 1 }],
      bar_path: { efficiency: 0.9 },
    });
    const track = parsePoseTrack(raw);
    expect(track?.fps).toBe(10);
    expect(track?.exercise).toBe('Back Squat');
    expect(track?.frames).toHaveLength(1);
    expect(track?.reps).toHaveLength(1);
    expect(track?.bar_path).toEqual({ efficiency: 0.9 });
  });

  it('returns null for garbage', () => {
    expect(parsePoseTrack('not json')).toBeNull();
    expect(parsePoseTrack(JSON.stringify({ foo: 1 }))).toBeNull();
  });

  it('defaults missing optional fields', () => {
    const track = parsePoseTrack(JSON.stringify({ frames: [] }));
    expect(track?.reps).toEqual([]);
    expect(track?.bar_path).toBeNull();
    expect(track?.fps).toBeNull();
  });
});

describe('frameIndexAt', () => {
  const track: PoseTrack = {
    version: 1,
    frames: [0, 1, 2, 3, 4].map((i) => frameAt(i / 10, [])),
    reps: [],
    bar_path: null,
  };

  it('finds the last frame at or before the time', () => {
    expect(frameIndexAt(track, 0)).toBe(0);
    expect(frameIndexAt(track, 0.25)).toBe(2);
    expect(frameIndexAt(track, 0.3)).toBe(3);
  });

  it('clamps past the end', () => {
    expect(frameIndexAt(track, 99)).toBe(4);
  });

  it('handles an empty track', () => {
    expect(frameIndexAt({ version: 1, frames: [], reps: [], bar_path: null }, 1)).toBe(-1);
  });
});

describe('letterbox', () => {
  it('centres a 16:9 video in a square container', () => {
    const box = letterbox(1000, 1000, 1920, 1080);
    expect(box.width).toBeCloseTo(1000);
    expect(box.height).toBeCloseTo(562.5);
    expect(box.offsetX).toBeCloseTo(0);
    expect(box.offsetY).toBeCloseTo(218.75);
  });

  it('falls back when video size is unknown', () => {
    const box = letterbox(640, 360, 0, 0);
    expect(box).toEqual({ offsetX: 0, offsetY: 0, width: 640, height: 360 });
  });
});

describe('barPoint', () => {
  it('uses the shoulder midpoint for squats', () => {
    const pts: [number, number, number][] = new Array(33).fill(lm(0, 0));
    pts[11] = lm(0.4, 0.2);
    pts[12] = lm(0.6, 0.2);
    expect(barPoint(pts, 'Back Squat')).toEqual([0.5, 0.2]);
  });

  it('uses the wrist midpoint for presses', () => {
    const pts: [number, number, number][] = new Array(33).fill(lm(0, 0));
    pts[15] = lm(0.3, 0.4);
    pts[16] = lm(0.7, 0.6);
    expect(barPoint(pts, 'Bench Press')).toEqual([0.5, 0.5]);
  });
});
