import { describe, it, expect } from 'vitest';
import { METRIC_GLOSSARY, glossary } from '@/lib/metricGlossary';

describe('metricGlossary (1.6)', () => {
  it('has non-empty entries for every key the UI references', () => {
    const used: (keyof typeof METRIC_GLOSSARY)[] = [
      'fatigue_index',
      'session_density',
      'power_variability',
      'decoupling',
      'warmup_flag',
      'alignment',
    ];
    for (const key of used) {
      expect(glossary(key).length).toBeGreaterThan(20);
    }
  });

  it('matches the backend fatigue scale (0-100)', () => {
    expect(METRIC_GLOSSARY.fatigue_index).toMatch(/0–100/);
  });
});
