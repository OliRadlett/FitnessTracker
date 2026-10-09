import { render, screen } from '@testing-library/react';
import { MetricCard } from '@/components/ui/MetricCard';
import { Stat } from '@/components/ui/Stat';

describe('honest-empty primitives', () => {
  it('MetricCard renders "No data yet" for null and suppresses the unit', () => {
    const { container } = render(
      <MetricCard label="FTP" value={null} color="text-foreground" unit="W" />,
    );
    expect(screen.getByText('No data yet')).toBeInTheDocument();
    expect(container.textContent).not.toContain('W');
  });

  it('MetricCard renders "No data yet" for undefined', () => {
    render(<MetricCard label="FTP" value={undefined} color="text-foreground" unit="W" />);
    expect(screen.getByText('No data yet')).toBeInTheDocument();
  });

  it("MetricCard treats '' and '—' as empty", () => {
    const { rerender } = render(
      <MetricCard label="FTP" value="" color="text-foreground" />,
    );
    expect(screen.getByText('No data yet')).toBeInTheDocument();
    rerender(<MetricCard label="FTP" value="—" color="text-foreground" />);
    expect(screen.getByText('No data yet')).toBeInTheDocument();
  });

  it('MetricCard renders 0 as real data with its unit', () => {
    const { container } = render(
      <MetricCard label="Rides" value={0} color="text-foreground" unit="rides" />,
    );
    expect(screen.queryByText('No data yet')).not.toBeInTheDocument();
    expect(container.textContent).toContain('0');
    expect(container.textContent).toContain('rides');
  });

  it('MetricCard honors the emptyText override', () => {
    render(
      <MetricCard label="FTP" value={null} color="text-foreground" emptyText="Sync to populate" />,
    );
    expect(screen.getByText('Sync to populate')).toBeInTheDocument();
  });

  it('Stat renders "No data yet" for null and suppresses the unit', () => {
    const { container } = render(<Stat label="CTL" value={null} unit="TSS" />);
    expect(screen.getByText('No data yet')).toBeInTheDocument();
    expect(container.textContent).not.toContain('TSS');
  });

  it("Stat treats '—' as empty", () => {
    render(<Stat label="CTL" value="—" />);
    expect(screen.getByText('No data yet')).toBeInTheDocument();
  });

  it('Stat renders value + unit intact when present', () => {
    const { container } = render(<Stat label="CTL" value={42} unit="TSS" delta="+2" />);
    expect(screen.queryByText('No data yet')).not.toBeInTheDocument();
    expect(container.textContent).toContain('42');
    expect(container.textContent).toContain('TSS');
    expect(container.textContent).toContain('+2');
  });

  it('Stat honors the emptyText override', () => {
    render(<Stat label="CTL" value={undefined} emptyText="Keep training" />);
    expect(screen.getByText('Keep training')).toBeInTheDocument();
  });
});
