import { describe, it, expect } from 'vitest';
import { renderAnalysisText } from '@/lib/analysisRenderer';
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
});
