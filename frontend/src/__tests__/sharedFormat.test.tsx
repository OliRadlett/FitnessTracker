import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { formatElevation, formatStat, setActivePreferences } from '@/lib/utils';
import { StatBadge } from '@/components/ui/StatBadge';
import type { ActivityCalendarEntry } from '@/lib/api';

// Reset the formatting singleton to defaults between tests.
beforeEach(() => {
  setActivePreferences({ unit_system: 'metric', locale: 'en-GB', time_format: '24h' });
});

function entry(over: Partial<ActivityCalendarEntry> = {}): ActivityCalendarEntry {
  return { id: 'a1', date: '2026-09-30', sport_type: 'Ride', name: 'Morning Ride', ...over };
}

describe('formatElevation', () => {
  it('rounds metres and appends a unit', () => {
    expect(formatElevation(1234.6)).toBe('1235 m');
  });

  it('treats 0 m as a real value, not missing', () => {
    expect(formatElevation(0)).toBe('0 m');
  });

  it('returns an em-dash for null/undefined', () => {
    expect(formatElevation(null)).toBe('—');
    expect(formatElevation(undefined)).toBe('—');
  });
});

describe('formatStat', () => {
  it('uses the focus for a strength session', () => {
    expect(formatStat(entry({ sport_type: 'WeightTraining', name: 'Push day', focus: 'Push' }))).toBe('Push');
  });

  it('falls back to the name for a strength session with no focus', () => {
    expect(formatStat(entry({ sport_type: 'WeightTraining', name: 'Push day' }))).toBe('Push day');
  });

  it('joins distance, duration and TSS with a middle dot', () => {
    expect(formatStat(entry({ distance_meters: 12500, duration_seconds: 1800, tss: 45 }))).toBe(
      '12.50 km · 30m · 45 TSS',
    );
  });

  it('falls back to the name when there is nothing to summarise', () => {
    expect(formatStat(entry({ name: 'Rest' }))).toBe('Rest');
  });
});

describe('StatBadge', () => {
  it('renders the label and value', () => {
    render(<StatBadge label="TSS" value={42} />);
    expect(screen.getByText('TSS')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders nothing when the value is missing', () => {
    const { container } = render(<StatBadge label="TSS" value={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('surfaces the hint as a tooltip and an info glyph', () => {
    render(<StatBadge label="Decoupling" value="4.2%" hint="Lower is better" />);
    expect(screen.getByTitle('Lower is better')).toBeInTheDocument();
    expect(screen.getByText('ⓘ')).toBeInTheDocument();
  });
});
