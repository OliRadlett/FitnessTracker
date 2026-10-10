import { describe, it, expect } from 'vitest';
import { parseInsightSections, renderAnalysisText, renderStructuredAnalysis } from '@/lib/analysisRenderer';
import { renderToStaticMarkup } from 'react-dom/server';

describe('renderAnalysisText bullets (0.9)', () => {
  it('renders asterisk bullets as lists, not literal text', () => {
    const html = renderToStaticMarkup(
      <>{renderAnalysisText('* Status & Trends: fine\n* Interpretation: ok')}</>,
    );
    expect(html).toContain('<ul');
    expect(html).not.toContain('* Status');
  });

  it('still renders dash bullets', () => {
    const html = renderToStaticMarkup(<>{renderAnalysisText('- one\n- two')}</>);
    expect(html).toContain('<ul');
  });

  it('renders #### subheadings as headings, not literal text', () => {
    const html = renderToStaticMarkup(<>{renderAnalysisText('#### Sleep detail\nSome prose')}</>);
    expect(html).toContain('<h4');
    expect(html).not.toContain('####');
  });
});

describe('parseInsightSections (InsightCard template)', () => {
  const SAMPLE = [
    '### HRV Overview',
    'HRV is stable.',
    '',
    '### Overall Score: 7.5 / 10',
    '',
    '### Top 3 Health Priorities',
    '1. Restore biometric tracking',
    '2. REM hygiene',
    '- Aerobic base',
    '',
    '### Lifestyle Modifications',
    'Walk daily.',
  ].join('\n');

  it('extracts the score and drops the score heading from the body', () => {
    const parsed = parseInsightSections(SAMPLE);
    expect(parsed.score).toEqual({ value: 7.5, scale: 10 });
    expect(parsed.bodyText).not.toContain('Overall Score');
    // Unrelated sections stay in the body — no data dropped.
    expect(parsed.bodyText).toContain('HRV Overview');
    expect(parsed.bodyText).toContain('Lifestyle Modifications');
  });

  it('extracts numbered and dash priorities, preserving the heading', () => {
    const parsed = parseInsightSections(SAMPLE);
    expect(parsed.prioritiesHeading).toBe('Top 3 Health Priorities');
    expect(parsed.priorities).toEqual([
      'Restore biometric tracking',
      'REM hygiene',
      'Aerobic base',
    ]);
    expect(parsed.bodyText).not.toContain('Top 3 Health Priorities');
  });

  it('renders score header, priority list, and no raw markdown literals', () => {
    const html = renderToStaticMarkup(<>{renderStructuredAnalysis(SAMPLE)}</>);
    expect(html).toContain('Overall score');
    expect(html).toContain('7.5');
    expect(html).toContain('Restore biometric tracking');
    expect(html).not.toContain('###');
    expect(html).not.toContain('####');
  });

  it('moves a method section into a collapsible details block', () => {
    const text = '### Summary\nFine.\n\n### Method\nWe averaged 7 days.\n';
    const parsed = parseInsightSections(text);
    expect(parsed.method).toEqual({ heading: 'Method', body: 'We averaged 7 days.' });
    const html = renderToStaticMarkup(<>{renderStructuredAnalysis(text)}</>);
    expect(html).toContain('<details');
    expect(html).toContain('We averaged 7 days.');
  });

  it('falls back to flat markdown when no sections are recognised', () => {
    const text = '### Notes\nJust prose.';
    const parsed = parseInsightSections(text);
    expect(parsed.score).toBeNull();
    expect(parsed.priorities).toEqual([]);
    expect(parsed.method).toBeNull();
    expect(parsed.bodyText).toBe(text);
  });
});
