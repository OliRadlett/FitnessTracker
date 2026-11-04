import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { StreamChart } from '@/components/activity/StreamChart';

/**
 * A ride without a power meter is the common case on this account — 5 streams,
 * no `watts`. The detail page used to say "no per-second streams" for those,
 * because it only charted when power existed. These pin the chart's behaviour
 * in that shape.
 */
describe('StreamChart', () => {
  const hr = Array.from({ length: 120 }, (_, i) => 130 + (i % 20));

  it('charts heart rate alone when there is no power stream', () => {
    render(<StreamChart watts={[]} hr={hr} />);

    expect(screen.getByLabelText('Heart rate over the ride')).toBeTruthy();
    expect(screen.queryByText('Power')).toBeNull();
    expect(screen.getByText(/peak 149 bpm/)).toBeTruthy();
  });

  it('does not claim independent scales when only one series exists', () => {
    const { container } = render(<StreamChart watts={[]} hr={hr} />);
    expect(container.textContent).not.toContain('scales independent');
  });

  it('charts both series when power is present', () => {
    const watts = Array.from({ length: 120 }, (_, i) => 150 + (i % 60));
    render(<StreamChart watts={watts} hr={hr} />);

    expect(screen.getByLabelText('Power and heart rate over the ride')).toBeTruthy();
    expect(screen.getByText('Power')).toBeTruthy();
    expect(screen.getByText(/scales independent/)).toBeTruthy();
  });
});
