import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { BarPathCard } from '@/components/lifting/VideoAnalysisPanel';

// Real numbers from the first production metric_3d (2bcc35e8, frontal squat:
// focal 712.8 user_lens, top 1.448 m, fb -483 mm, lateral 98 mm).
const WITH_3D = JSON.stringify({
  source: 'proxy_offset',
  confidence: 0.678,
  n_reps: 8,
  efficiency: 0.47,
  drift_ratio: 0.108,
  consistency: 94.1,
  metric_3d: {
    basis: 'metric_3d',
    n_reps: 8,
    n_frames: 76,
    bar_height_top_m: 1.448,
    bar_height_bottom_m: 1.166,
    vertical_range_m: 0.294,
    front_back_mm: -483.4,
    lateral_mm: 98.3,
    net_lateral_mm: 28.5,
    per_rep: [],
    calibration: {
      focal_px: 712.8,
      focal_source: 'user_lens',
      subject_distance_m: 2.32,
      px_per_m: 306.8,
      lifter_height_m: 1.85,
      height_scale: 1.416,
      scale_spread: 0.324,
    },
    note: 'Metric 3D.',
  },
});

const WITHOUT_3D = JSON.stringify({
  source: 'proxy_offset',
  efficiency: 0.47,
  drift_ratio: 0.108,
  consistency: 94.1,
});

describe('BarPathCard metric 3D section', () => {
  it('renders bar height, travel and calibration', () => {
    render(<BarPathCard value={WITH_3D} />);
    expect(screen.getByText('Bar height (3D)')).toBeInTheDocument();
    expect(screen.getByText('1.45 m')).toBeInTheDocument();
    expect(screen.getByText('1.17 m')).toBeInTheDocument();
    expect(screen.getByText('0.29 m')).toBeInTheDocument();
    expect(screen.getByText(/f 713 px/)).toBeInTheDocument();
    expect(screen.getByText(/\(lens\)/)).toBeInTheDocument();
    expect(screen.getByText('3D')).toBeInTheDocument();
  });

  it('flags the horizontals as approximate', () => {
    render(<BarPathCard value={WITH_3D} />);
    expect(screen.getByText('~-483 mm')).toBeInTheDocument();
    expect(screen.getByText('~98 mm')).toBeInTheDocument();
    expect(
      screen.getByText(/Horizontal 3D numbers are approximate/),
    ).toBeInTheDocument();
  });

  it('renders nothing 3D without metric_3d', () => {
    render(<BarPathCard value={WITHOUT_3D} />);
    expect(screen.queryByText('Bar height (3D)')).not.toBeInTheDocument();
    // The 2D card itself still renders.
    expect(screen.getByText('Bar path')).toBeInTheDocument();
  });

  it('renders nothing for empty input', () => {
    const { container } = render(<BarPathCard value={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
