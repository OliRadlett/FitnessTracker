/**
 * P2 density (ui-redesign-v2 t4): climb rows consolidate rather than cut.
 *
 * `segmentBadgeItems` is the pure rule behind `SegmentBadges`: it drops the
 * climb-type chip when it says the same thing as the category chip ("HC"
 * type on a "HC" climb), and `humanizeClimbType` keeps raw snake_case (e.g.
 * `sustained_steep`) from leaking into the row. Display-only — stored values
 * are untouched and every chip's data stays reachable via its tooltip/title.
 */
import { describe, it, expect } from 'vitest';
import type { Segment } from '@/lib/api/types';
import { humanizeClimbType, segmentBadgeItems } from '@/components/routes/SegmentRow';

function makeSegment(over: Partial<Segment> = {}): Segment {
  return {
    id: 'seg-1',
    route_id: 'route-a',
    route_name: 'Box Hill',
    name: 'Box Hill Climb',
    start_dist_m: 500,
    end_dist_m: 1500,
    distance_m: 1000,
    elevation_gain_m: 100,
    avg_gradient_pct: 10,
    max_gradient_pct: 12.5,
    peak_elevation_m: 150,
    start_lat: 51.44,
    start_lng: -0.27,
    end_lat: 51.45,
    end_lng: -0.27,
    climb_category: '4',
    pr_seconds: 300,
    best_avg_power_watts: 280,
    times_ridden: 3,
    has_pr: true,
    effort_count: 3,
    cluster_id: 1,
    geo_cluster_id: null,
    geo_cluster_size: 1,
    climb_type: 'punchy',
    sustainedness: 0.8,
    difficulty_score: 7.5,
    predicted_vam: 900,
    predicted_time_seconds: 310,
    predicted_power_watts: 275,
    prediction_confidence: 0.7,
    intelligence_analyzed_at: null,
    ...over,
  };
}

describe('humanizeClimbType', () => {
  it('keeps known short labels', () => {
    expect(humanizeClimbType('punchy')).toBe('Punchy');
    expect(humanizeClimbType('steady')).toBe('Steady');
  });

  it('title-cases raw snake_case instead of leaking it', () => {
    expect(humanizeClimbType('sustained_steep')).toBe('Sustained Steep');
  });
});

describe('segmentBadgeItems', () => {
  it('merges a climb-type chip identical to the category', () => {
    const items = segmentBadgeItems(
      makeSegment({ climb_category: 'HC', climb_type: 'hc' }),
    );
    const labels = items.map((i) => i.label);
    expect(labels).toContain('Cat HC');
    // One HC chip, not two — the duplicate carries no information.
    expect(labels.filter((l) => l.toLowerCase() === 'hc')).toHaveLength(0);
    expect(labels).not.toContain('HC');
  });

  it('keeps a climb-type chip that adds information', () => {
    const items = segmentBadgeItems(
      makeSegment({ climb_category: '4', climb_type: 'punchy' }),
    );
    const labels = items.map((i) => i.label);
    expect(labels).toContain('Cat 4');
    expect(labels).toContain('Punchy');
  });

  it('keeps difficulty and sustainedness alongside', () => {
    const items = segmentBadgeItems(makeSegment());
    const labels = items.map((i) => i.label);
    expect(labels).toContain('7.5 diff');
    expect(labels).toContain('sust 80%');
  });
});
