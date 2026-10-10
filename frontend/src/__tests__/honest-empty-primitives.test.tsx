import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MetricCard } from '@/components/ui/MetricCard';
import { Stat } from '@/components/ui/Stat';

// Honest Empty (ui-redesign-v2 §4 moment 4) for the shared primitives:
// missing values render muted "No data yet" microcopy instead of a bare '—',
// overridable per caller via `emptyText`. Presentational only.

describe('MetricCard honest empty', () => {
  it('renders "No data yet" for null/undefined instead of an em-dash', () => {
    const { rerender } = render(<MetricCard label="FTP" value={null} color="text-accent" />);
    expect(screen.getByText('No data yet')).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
    rerender(<MetricCard label="FTP" value={undefined} color="text-accent" />);
    expect(screen.getByText('No data yet')).toBeInTheDocument();
  });

  it('treats empty-string and em-dash values as no data', () => {
    const { rerender } = render(<MetricCard label="Recovery" value="—" color="text-accent" />);
    expect(screen.getByText('No data yet')).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
    rerender(<MetricCard label="Recovery" value="" color="text-accent" />);
    expect(screen.getByText('No data yet')).toBeInTheDocument();
  });

  it('treats 0 as real data, not missing', () => {
    render(<MetricCard label="Rides" value={0} color="text-accent" />);
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByText('No data yet')).not.toBeInTheDocument();
  });

  it('lets the caller override the null-state microcopy', () => {
    render(
      <MetricCard label="FTP" value={null} color="text-accent" emptyText="Connect Strava to populate" />,
    );
    expect(screen.getByText('Connect Strava to populate')).toBeInTheDocument();
  });

  it('suppresses the unit when there is no data', () => {
    const { container } = render(<MetricCard label="FTP" value={null} color="text-accent" unit="W" />);
    expect(container.textContent).not.toContain('W');
  });
});

describe('Stat honest empty', () => {
  it('renders "No data yet" for null/undefined instead of blank', () => {
    const { rerender } = render(<Stat label="Steepest" value={null} />);
    expect(screen.getByText('No data yet')).toBeInTheDocument();
    rerender(<Stat label="Steepest" value={undefined} />);
    expect(screen.getByText('No data yet')).toBeInTheDocument();
  });

  it('treats empty-string and em-dash values as no data', () => {
    const { rerender } = render(<Stat label="Steepest" value="—" />);
    expect(screen.getByText('No data yet')).toBeInTheDocument();
    rerender(<Stat label="Steepest" value="" />);
    expect(screen.getByText('No data yet')).toBeInTheDocument();
  });

  it('renders real values with their unit untouched', () => {
    render(<Stat label="Steepest" value="8.4" unit="%" />);
    expect(screen.getByText('8.4')).toBeInTheDocument();
    expect(screen.getByText('%')).toBeInTheDocument();
  });

  it('lets the caller override the null-state microcopy', () => {
    render(<Stat label="Steepest" value={null} emptyText="Detect climbs from a route first" />);
    expect(screen.getByText('Detect climbs from a route first')).toBeInTheDocument();
  });
});
