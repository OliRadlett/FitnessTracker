import { describe, expect, it } from 'vitest';

import { routeNamesDiffer } from '@/lib/routeUtils';

/**
 * The guard on `identical` merges.
 *
 * An `identical` merge is the only kind that trains the embedding metric, so
 * a wrong one is permanent — a `variant` merge is excluded from training and
 * can be reclassified from the merge log. Differently-named pairs are where
 * the doubt belongs, because Strava auto-generates route names: the same ride
 * arrives as "Evening Ride" one day and "Afternoon Ride" another, and 59 of
 * 120 candidate pairs on production have differing names.
 *
 * This is a prompt to look, not a duplicate test. Names matching does not
 * make two routes identical, and names differing does not make them distinct.
 */
describe('routeNamesDiffer', () => {
  it('treats identical names as not differing', () => {
    expect(routeNamesDiffer('The Stag', 'The Stag')).toBe(false);
  });

  it('is case insensitive', () => {
    expect(routeNamesDiffer('Evening Ride', 'evening ride')).toBe(false);
  });

  it('ignores surrounding and repeated whitespace', () => {
    expect(routeNamesDiffer('Evening   Ride', '  Evening Ride ')).toBe(false);
  });

  it('detects genuinely different names', () => {
    expect(routeNamesDiffer('Lap of Edinburgh', 'Artisan Roast')).toBe(true);
  });

  it('detects the auto-generated case that motivates the guard', () => {
    expect(routeNamesDiffer('Cycling', 'From Tranent to North Berwick')).toBe(true);
  });

  it('handles a missing name', () => {
    expect(routeNamesDiffer(null, 'Evening Ride')).toBe(true);
    expect(routeNamesDiffer('Evening Ride', null)).toBe(true);
  });

  it('treats two missing names as not differing', () => {
    expect(routeNamesDiffer(null, null)).toBe(false);
    expect(routeNamesDiffer('', '')).toBe(false);
  });
});