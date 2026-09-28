/**
 * The notifications page used to fetch `limit=200` unfiltered and then apply
 * the read/type filters in the browser. That capped every filter at the newest
 * 200 rows: a user with 4,000 notifications saw "unread" only for the ones
 * that happened to be in the most recent page, and the type <select> lost any
 * type that had fallen out of it.
 *
 * These tests pin the fixed behaviour — the filters reach the server as query
 * params, and the chips/badge read from the whole-history summary.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const listNotifications = vi.fn();
const getNotificationSummary = vi.fn();
const markNotificationRead = vi.fn();
const markAllNotificationsRead = vi.fn();

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    useAuthFetch: () => ({ authFetch: vi.fn(), token: 'test-token' }),
    listNotifications: (...args: unknown[]) => listNotifications(...args),
    getNotificationSummary: (...args: unknown[]) => getNotificationSummary(...args),
    markNotificationRead: (...args: unknown[]) => markNotificationRead(...args),
    markAllNotificationsRead: (...args: unknown[]) => markAllNotificationsRead(...args),
  };
});

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

vi.mock('@/lib/usePageTitle', () => ({ usePageTitle: () => {} }));

import NotificationsPage from '@/app/(app)/notifications/page';

function makeNotification(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'n1',
    type: 'pr',
    title: 'Squat PR',
    body: '150 kg x 3',
    severity: 'success',
    link: '/lifting',
    read: false,
    created_at: '2026-09-20T10:00:00Z',
    payload: null,
    ...over,
  };
}

/** Args the page passed on the most recent listNotifications call. */
function lastFilters() {
  const call = listNotifications.mock.calls.at(-1)!;
  return call[1] as Record<string, unknown>;
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NotificationsPage />
    </QueryClientProvider>,
  );
}

/** The type <select> is populated from the summary, so it appears async. */
async function waitForTypeOption(value: string) {
  await waitFor(() => {
    const options = Array.from(
      screen.getByLabelText('Filter by type').querySelectorAll('option'),
    ).map((o) => (o as HTMLOptionElement).value);
    expect(options).toContain(value);
  });
}

describe('NotificationsPage filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listNotifications.mockResolvedValue([makeNotification()]);
    getNotificationSummary.mockResolvedValue({
      total: 4000,
      unread: 17,
      by_type: { pr: 1200, health_alert: 300 },
    });
  });

  it('requests the unfiltered set with no read/type params by default', async () => {
    renderPage();
    await waitFor(() => expect(listNotifications).toHaveBeenCalled());
    const filters = lastFilters();
    expect(filters.read).toBeUndefined();
    expect(filters.type).toBeUndefined();
    expect(filters.limit).toBe(200);
  });

  it('loads the whole-history summary alongside the list', async () => {
    renderPage();
    await waitFor(() => expect(getNotificationSummary).toHaveBeenCalled());
  });

  it('sends read=false when the Unread chip is selected', async () => {
    renderPage();
    await waitFor(() => expect(listNotifications).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /^Unread/ }));
    await waitFor(() => expect(lastFilters().read).toBe(false));
  });

  it('sends read=true when the Read chip is selected', async () => {
    renderPage();
    await waitFor(() => expect(listNotifications).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Read' }));
    await waitFor(() => expect(lastFilters().read).toBe(true));
  });

  it('sends the selected type to the server', async () => {
    renderPage();
    await waitForTypeOption('pr');
    fireEvent.change(screen.getByLabelText('Filter by type'), {
      target: { value: 'pr' },
    });
    await waitFor(() => expect(lastFilters().type).toBe('pr'));
  });

  it('combines read and type into one request', async () => {
    renderPage();
    await waitForTypeOption('pr');
    fireEvent.click(screen.getByRole('button', { name: /^Unread/ }));
    fireEvent.change(screen.getByLabelText('Filter by type'), {
      target: { value: 'pr' },
    });
    await waitFor(() => {
      expect(lastFilters()).toMatchObject({ read: false, type: 'pr' });
    });
  });

  it('does not filter in the browser — the response is already the result set', async () => {
    // A server that correctly honours read=false returns only unread rows.
    // The page must render exactly what it got, not re-filter it.
    listNotifications.mockResolvedValue([
      makeNotification({ id: 'u1', title: 'Back squat PR' }),
      makeNotification({ id: 'u2', title: 'Bench press PR' }),
    ]);
    renderPage();
    await waitForTypeOption('pr');
    const callsBefore = listNotifications.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /^Unread/ }));
    await waitFor(() => expect(screen.getByText('Back squat PR')).toBeInTheDocument());
    expect(screen.getByText('Bench press PR')).toBeInTheDocument();
    // Every request issued after the filter carried it — nothing was narrowed
    // client-side afterwards (the old code filtered the whole response).
    const afterFilter = listNotifications.mock.calls.slice(callsBefore);
    expect(afterFilter.length).toBeGreaterThan(0);
    for (const call of afterFilter) {
      expect((call[1] as Record<string, unknown>).read).toBe(false);
    }
  });

  it('type options come from the summary, including types not in the loaded page', async () => {
    // The page only holds `pr` rows; `health_alert` exists purely in the
    // summary. A client-side count would have dropped it from the menu.
    listNotifications.mockResolvedValue([makeNotification({ type: 'pr' })]);
    renderPage();
    await waitForTypeOption('health_alert');
    const options = Array.from(
      screen.getByLabelText('Filter by type').querySelectorAll('option'),
    ).map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(expect.arrayContaining(['all', 'pr', 'health_alert']));
  });

  it('shows the summary unread count on the Unread chip, not the loaded count', async () => {
    // Only one unread row is loaded, but the summary says 17 exist.
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Unread/ }).textContent).toContain('17');
    });
  });

  it('hides "Mark all read" once nothing is unread', async () => {
    getNotificationSummary.mockResolvedValue({ total: 5, unread: 0, by_type: { pr: 5 } });
    renderPage();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Mark all read' })).toBeNull();
    });
  });

  it('shows "Mark all read" while unread remain', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Mark all read' })).toBeInTheDocument();
    });
  });

  it('resets the "show more" depth when the filter changes', async () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      makeNotification({ id: `x${i}`, title: `Row ${i}` }),
    );
    listNotifications.mockResolvedValue(many);
    renderPage();
    await waitFor(() => expect(screen.getByText('Row 0')).toBeInTheDocument());
    // The list is client-paged at 50; row 59 is beyond the initial window.
    expect(screen.queryByText('Row 59')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /show more|load more/i }));
    await waitFor(() => expect(screen.getByText('Row 59')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^Unread/ }));
    await waitFor(() => expect(listNotifications).toHaveBeenCalledTimes(2));
    // Back to the first page, not still showing 60 rows.
    expect(screen.queryByText('Row 59')).toBeNull();
  });

  it('marking read refetches rather than patching, so filtered sets stay correct', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Squat PR')).toBeInTheDocument());
    const callsBefore = listNotifications.mock.calls.length;
    fireEvent.click(screen.getByText('Squat PR'));
    await waitFor(() =>
      expect(markNotificationRead).toHaveBeenCalledWith(expect.anything(), 'n1'),
    );
    // A new request is issued because the row may no longer belong in the set.
    await waitFor(() =>
      expect(listNotifications.mock.calls.length).toBeGreaterThan(callsBefore),
    );
  });

  it('marks all read and refetches', async () => {
    markAllNotificationsRead.mockResolvedValue({ marked: 17 });
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Mark all read' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expect(markAllNotificationsRead).toHaveBeenCalled());
    await waitFor(() => expect(getNotificationSummary.mock.calls.length).toBeGreaterThan(1));
  });

  it('falls back to the loaded rows when the summary request fails', async () => {
    getNotificationSummary.mockRejectedValue(new Error('summary down'));
    renderPage();
    await waitFor(() => expect(listNotifications).toHaveBeenCalled());
    // One loaded row is unread, so "Mark all read" still appears and the chip
    // count is derived from the list rather than crashing on undefined.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Mark all read' })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /^Unread/ })).toBeInTheDocument();
  });
});
