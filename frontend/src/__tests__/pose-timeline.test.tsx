import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { PoseTimeline } from '@/components/lifting/PoseTimeline';
import type { PoseTrack } from '@/lib/pose/track';

function makeTrack(reps: PoseTrack['reps']): PoseTrack {
  return { version: 1, fps: 10, frames: [], reps, bar_path: null };
}

describe('PoseTimeline', () => {
  it('renders a bar per rep with a velocity label', () => {
    const ref = { current: document.createElement('video') };
    const track = makeTrack([
      { rep_number: 1, start_time: 1, end_time: 2, concentric_velocity_ms: 0.3 },
      { rep_number: 2, start_time: 3, end_time: 4, concentric_velocity_ms: 0.2 },
    ]);
    render(<PoseTimeline videoRef={ref} track={track} />);
    expect(screen.getByLabelText('Rep 1, 0.30 m/s')).toBeInTheDocument();
    expect(screen.getByLabelText('Rep 2, 0.20 m/s')).toBeInTheDocument();
  });

  it('seeks the video when a rep bar is clicked', () => {
    const video = document.createElement('video');
    const ref = { current: video };
    const track = makeTrack([
      { rep_number: 1, start_time: 1, end_time: 2, concentric_velocity_ms: 0.3 },
      { rep_number: 2, start_time: 5, end_time: 6, concentric_velocity_ms: 0.2 },
    ]);
    render(<PoseTimeline videoRef={ref} track={track} />);
    fireEvent.click(screen.getByLabelText('Rep 2, 0.20 m/s'));
    expect(video.currentTime).toBe(5);
  });

  it('renders nothing without reps', () => {
    const ref = { current: document.createElement('video') };
    const { container } = render(<PoseTimeline videoRef={ref} track={makeTrack([])} />);
    expect(container).toBeEmptyDOMElement();
  });
});
