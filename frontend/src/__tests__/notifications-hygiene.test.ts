import { describe, expect, it } from 'vitest';
import {
  bodyLeaksInternalError,
  displayNotificationBody,
  groupReauthByProvider,
  reauthDisplayName,
  reauthGroupBody,
  reauthProvider,
} from '@/lib/api/notifications';
import type { AppNotification } from '@/lib/api/types/notifications';

function makeNotification(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: 'n1',
    type: 'video_processed',
    title: 'Video processing failed',
    body: 'ok',
    severity: 'error',
    link: '/lifting/videos',
    read: false,
    created_at: '2026-10-01T00:00:00Z',
    payload: null,
    ...overrides,
  };
}

const NUMPY_LEAK =
  "Failed to process your video: Deserialization failed because the 'numpy' module is not available in the local environment.";

describe('bodyLeaksInternalError', () => {
  it('flags the numpy deployment leak', () => {
    expect(bodyLeaksInternalError(NUMPY_LEAK)).toBe(true);
  });

  it('flags tracebacks and missing-module errors', () => {
    expect(bodyLeaksInternalError('Traceback (most recent call last): ...')).toBe(true);
    expect(bodyLeaksInternalError("No module named 'pandas'")).toBe(true);
    expect(bodyLeaksInternalError('ImportError: cannot import name x')).toBe(true);
  });

  it('leaves normal user-facing copy alone', () => {
    expect(bodyLeaksInternalError('66.0 kg × 10 — e1RM 88.0 kg')).toBe(false);
    expect(
      bodyLeaksInternalError('Your connection stopped syncing. Reconnect from Settings.'),
    ).toBe(false);
    expect(bodyLeaksInternalError(null)).toBe(false);
    expect(bodyLeaksInternalError('')).toBe(false);
  });
});

describe('displayNotificationBody', () => {
  it('replaces a leaked video error with plain language and no module names', () => {
    const body = displayNotificationBody(makeNotification({ body: NUMPY_LEAK }));
    expect(body).not.toMatch(/numpy/i);
    expect(body).not.toMatch(/deserialization/i);
    expect(body).toMatch(/couldn.t process your video/);
  });

  it('passes clean bodies through untouched', () => {
    const clean = '66.0 kg × 10 — e1RM 88.0 kg';
    expect(displayNotificationBody(makeNotification({ body: clean })).toString()).toBe(clean);
  });

  it('falls back to generic copy for unknown leaking types', () => {
    const body = displayNotificationBody(
      makeNotification({ type: 'weekly_summary', body: 'Traceback: boom' }),
    );
    expect(body).not.toMatch(/traceback/i);
    expect(body).toMatch(/try again later/);
  });
});

describe('reauth grouping', () => {
  const whoop = (id: string, created_at: string) =>
    makeNotification({
      id,
      type: 'connection_reauth',
      title: 'whoop needs re-authentication',
      body: 'Your connection stopped syncing.',
      created_at,
      payload: { provider: 'whoop' },
    });
  const withings = (id: string, created_at: string) =>
    makeNotification({
      id,
      type: 'connection_reauth',
      title: 'withings needs re-authentication',
      body: 'Your connection stopped syncing.',
      created_at,
      payload: { provider: 'withings' },
    });

  it('dedupes identical repeats per provider, newest provider first', () => {
    const pr = makeNotification({ id: 'pr', type: 'pr', title: 'Back Squat PR', created_at: '2026-10-03T00:00:00Z' });
    const groups = groupReauthByProvider([
      withings('w2', '2026-10-02T00:00:00Z'),
      pr,
      whoop('h1', '2026-10-01T00:00:00Z'),
      whoop('h2', '2026-09-20T00:00:00Z'),
      withings('w1', '2026-09-15T00:00:00Z'),
    ]);
    expect(groups.map((g) => g.provider)).toEqual(['withings', 'whoop']);
    expect(groups[0].items.map((i) => i.id)).toEqual(['w2', 'w1']);
    expect(groups[1].items.map((i) => i.id)).toEqual(['h1', 'h2']);
    expect(groups[0].displayName).toBe('Withings');
  });

  it('derives the provider from the title when the payload is missing', () => {
    const n = whoop('h1', '2026-10-01T00:00:00Z');
    expect(reauthProvider({ ...n, payload: null })).toBe('whoop');
    expect(reauthProvider(makeNotification({ title: '???' }))).toBe('unknown');
  });

  it('names providers for humans', () => {
    expect(reauthDisplayName('whoop')).toBe('Whoop');
    expect(reauthDisplayName('Withings')).toBe('Withings');
    expect(reauthDisplayName('unknown')).toBe('A connection');
  });

  it('escalates copy with the repeat count', () => {
    expect(reauthGroupBody('Whoop', 1)).toMatch(/Reconnect to keep your data fresh/);
    expect(reauthGroupBody('Whoop', 1)).not.toMatch(/6|times/);
    const escalated = reauthGroupBody('Whoop', 6);
    expect(escalated).toMatch(/6 times/);
    expect(escalated).toMatch(/Reconnect once/);
  });
});
