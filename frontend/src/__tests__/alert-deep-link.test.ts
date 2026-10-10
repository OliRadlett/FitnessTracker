import { describe, expect, it } from 'vitest';
import {
  healthAlertKey,
  healthAlertLink,
  resolveHealthAlert,
  summarizeNotificationBody,
} from '@/lib/api/notifications';
import type { AppNotification } from '@/lib/api/types/notifications';
import type { HealthAlert } from '@/lib/api/types/health';

function makeNotification(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: 'n1',
    type: 'health_alert',
    title: 'HRV dropped',
    body: 'Your HRV has dropped significantly over the last 7 days.',
    severity: 'warning',
    link: '/health',
    read: false,
    created_at: '2026-10-01T00:00:00Z',
    payload: { alert_type: 'hrv_drop' },
    ...overrides,
  };
}

function makeAlert(overrides: Partial<HealthAlert> = {}): HealthAlert {
  return {
    id: 'a1',
    alert_type: 'hrv_drop',
    severity: 'warning',
    title: 'HRV dropped',
    description: 'Full text lives here.',
    detected_date: '2026-10-01',
    status: 'active',
    ...overrides,
  };
}

describe('healthAlertLink', () => {
  it('deep-links health alerts to /health?alert=<alert_type>', () => {
    expect(healthAlertLink(makeNotification())).toBe('/health?alert=hrv_drop');
  });

  it('prefers an alert id when the payload carries one', () => {
    const n = makeNotification({ payload: { alert_id: 'a1', alert_type: 'hrv_drop' } });
    expect(healthAlertLink(n)).toBe('/health?alert=a1');
  });

  it('falls back to bare /health without a resolvable key', () => {
    expect(healthAlertLink(makeNotification({ payload: null }))).toBe('/health');
  });

  it('leaves every other notification type on its stored link', () => {
    const n = makeNotification({ type: 'pr', link: '/lifting?tab=prs', payload: null });
    expect(healthAlertLink(n)).toBe('/lifting?tab=prs');
  });
});

describe('summarizeNotificationBody', () => {
  it('passes short health bodies through untouched', () => {
    const n = makeNotification({ body: 'Short.' });
    expect(summarizeNotificationBody(n)).toBe('Short.');
  });

  it('truncates long health bodies at a word boundary with an ellipsis', () => {
    const n = makeNotification({ body: `${'word '.repeat(50)}tail` });
    const out = summarizeNotificationBody(n);
    expect(out.length).toBeLessThanOrEqual(161);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/ wor$/);
  });

  it('leaves non-health bodies alone at any length', () => {
    const n = makeNotification({ type: 'pr', body: 'x'.repeat(300), payload: null });
    expect(summarizeNotificationBody(n)).toBe('x'.repeat(300));
  });
});

describe('resolveHealthAlert', () => {
  const alerts = [makeAlert(), makeAlert({ id: 'a2', alert_type: 'sleep_decline', title: 'Sleep declining' })];

  it('matches exact id first', () => {
    expect(resolveHealthAlert(alerts, 'a2')?.alert_type).toBe('sleep_decline');
  });

  it('falls back to alert_type, case-insensitively', () => {
    expect(resolveHealthAlert(alerts, 'HRV_DROP')?.id).toBe('a1');
  });

  it('falls back to title, case-insensitively', () => {
    expect(resolveHealthAlert(alerts, 'sleep declining')?.id).toBe('a2');
  });

  it('returns null for empty keys and stale links', () => {
    expect(resolveHealthAlert(alerts, null)).toBeNull();
    expect(resolveHealthAlert(alerts, '')).toBeNull();
    expect(resolveHealthAlert(alerts, 'nope')).toBeNull();
  });

  it('exposes the key extractor for the notifications page', () => {
    expect(healthAlertKey(makeNotification())).toBe('hrv_drop');
    expect(healthAlertKey(makeNotification({ payload: null }))).toBeNull();
  });
});
