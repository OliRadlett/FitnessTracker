import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { VelocitySparkline } from '@/components/lifting/VelocitySparkline';
import type { PoseTrack } from '@/lib/pose/track';

function lm(x: number, y: number): [number, number, number] {
  const pts: [number, number, number][] = new Array(33).fill([0.5, 0.5, 1]);
  pts[11] = [0.5, 0.2, 1];
  pts[12] = [0.5, 0.2, 1];
  pts[15] = [x, y, 1];
  pts[16] = [x, y, 1];
  return pts as unknown as [number, number, number][];
}

describe('VelocitySparkline', () => {
  it('renders the sparkline with a playhead marker', () => {
    const ref = { current: document.createElement('video') };
    const frames = [0, 1, 2, 3, 4].map((i) => ({
      t: i * 0.1,
      lm: lm(0.5 + i * 0.01, 0.5),
      w: null,
    }));
    const track: PoseTrack = {
      version: 1,
      fps: 10,
      exercise: 'Bench Press',
      frames,
      reps: [],
      bar_path: null,
    };
    const { container } = render(<VelocitySparkline videoRef={ref} track={track} />);
    expect(screen.getByLabelText('Bar speed')).toBeInTheDocument();
    expect(container.querySelector('path')).toBeInTheDocument();
    expect(container.querySelector('line')).toBeInTheDocument();
  });
});
