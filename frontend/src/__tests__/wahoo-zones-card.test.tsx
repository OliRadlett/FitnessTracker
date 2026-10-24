/**
 * Wahoo power-zone sync card (plans/wahoo-zone-sync.md). Pins the states the card
 * exists to get right: drift direction in plain words, the read-only HR section,
 * revert offered only when a prior snapshot exists, the toggle's PATCH-then-push
 * order, and a *skip-only* push never reading as success.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const getWahooZones = vi.fn();
const pushWahooZones = vi.fn();
const revertWahooZones = vi.fn();
const updateCyclingProfile = vi.fn();

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    useAuthFetch: () => ({ authFetch: vi.fn(), token: 'test-token' }),
    getWahooZones: (...args: unknown[]) => getWahooZones(...args),
    pushWahooZones: (...args: unknown[]) => pushWahooZones(...args),
    revertWahooZones: (...args: unknown[]) => revertWahooZones(...args),
    updateCyclingProfile: (...args: unknown[]) => updateCyclingProfile(...args),
  };
});

import { WahooZonesCard } from '@/components/cycling/WahooZonesCard';

const HR_NOTE =
  'Wahoo does not expose heart rate zones through its Cloud API — there is no heart_rate_zones endpoint.';

function status(over: Record<string, unknown> = {}) {
  return {
    connected: true,
    connection_status: 'active',
    opt_in: true,
    can_write: true,
    hr_write_supported: false,
    hr_note: HR_NOTE,
    local_sets: [
      {
        zone_kind: 'power',
        anchor_kind: 'ftp',
        anchor_value: 250,
        zones: [{ zone: 'z1', zone_name: 'Recovery', lower: 0, upper: 137 }],
      },
      {
        zone_kind: 'heart_rate',
        anchor_kind: 'lthr',
        anchor_value: 170,
        zones: [
          { zone: 'z1', zone_name: 'HR Recovery', lower: 100, upper: 120 },
          { zone: 'z5', zone_name: 'HR VO2max', lower: 165, upper: null },
        ],
      },
    ],
    wahoo_sets: [
      { id: 77, workout_type_location_id: 0, ftp: 232, zones: [], provenance: 'platform' },
    ],
    tracked: [],
    drift: [],
    error_code: null,
    error: null,
    ...over,
  };
}

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WahooZonesCard />
    </QueryClientProvider>,
  );
}

describe('WahooZonesCard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('states the drift direction in plain words and shows the HR note verbatim', async () => {
    getWahooZones.mockResolvedValue(
      status({
        drift: [
          {
            zone_kind: 'power',
            workout_type_location_id: 0,
            wahoo_zone_set_id: 77,
            local_anchor: 250,
            wahoo_anchor: 232,
            delta: -18,
          },
          {
            zone_kind: 'power',
            workout_type_location_id: 1,
            wahoo_zone_set_id: 78,
            local_anchor: 250,
            wahoo_anchor: 262,
            delta: 12,
          },
        ],
        tracked: [
          {
            id: 't1',
            zone_kind: 'power',
            workout_type_family_id: 0,
            workout_type_location_id: 0,
            wahoo_zone_set_id: 77,
            anchor_value: 250,
            boundaries: null,
            has_prior: true,
            pushed_at: '2026-10-16T09:00:00Z',
            last_error: 'Wahoo rejected the zone write (500).',
          },
        ],
      }),
    );

    renderCard();

    expect(await screen.findByText(/your device is 18 W behind/)).toBeInTheDocument();
    expect(screen.getByText(/12 W ahead/)).toBeInTheDocument();
    expect(screen.getByText(HR_NOTE)).toBeInTheDocument();
    expect(screen.getByText('HR Recovery')).toBeInTheDocument();
    expect(screen.getByText('165–∞ bpm')).toBeInTheDocument();
    // has_prior on a tracked set is what makes revert offerable.
    expect(
      screen.getByRole('button', { name: 'Revert to previous Wahoo zones' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Wahoo rejected the zone write (500).')).toBeInTheDocument();
    // No HR push control anywhere: no control on this card even names HR zones.
    const buttonLabels = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    expect(buttonLabels.filter((text) => /heart|hr\b/i.test(text))).toEqual([]);
  });

  it('toggles opt-in on: PATCH first, then push, and surfaces skip-only results', async () => {
    getWahooZones.mockResolvedValue(status({ opt_in: false }));
    updateCyclingProfile.mockResolvedValue({ id: 'p1' });
    pushWahooZones.mockResolvedValue({
      ftp: 250,
      updated: [],
      created: [],
      skipped: [
        { id: 77, reason: 'already_current' },
        { id: 78, reason: 'no_anchor' },
      ],
      foreign: [99],
      reason: null,
    });

    renderCard();
    const toggle = await screen.findByRole('switch', {
      name: 'Keep my Wahoo zones in sync with FitTrack',
    });
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(toggle);

    await waitFor(() =>
      expect(updateCyclingProfile).toHaveBeenCalledWith(expect.anything(), {
        push_wahoo_zones: true,
      }),
    );
    await waitFor(() => expect(pushWahooZones).toHaveBeenCalledTimes(1));
    // The PATCH has to land before the push.
    expect(updateCyclingProfile.mock.invocationCallOrder[0]).toBeLessThan(
      pushWahooZones.mock.invocationCallOrder[0],
    );

    expect(await screen.findByText('Nothing was written to Wahoo.')).toBeInTheDocument();
    expect(screen.getByText(/Indoor set left alone — already matched your FTP/)).toBeInTheDocument();
    expect(
      screen.getByText(/Wahoo reported no FTP for it, so its boundaries can't be rescaled/),
    ).toBeInTheDocument();
    expect(
      screen.getByText('A set managed by another app was left alone.'),
    ).toBeInTheDocument();
  });

  it('disables the push with the reason when the connection is missing', async () => {
    getWahooZones.mockResolvedValue(
      status({
        connected: false,
        connection_status: null,
        can_write: false,
        wahoo_sets: [],
        error_code: 'no_connection',
        error: 'No Wahoo connection. Connect Wahoo in Settings.',
      }),
    );

    renderCard();

    expect(await screen.findByText('No Wahoo connection. Connect Wahoo in Settings.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Push power zones now' })).toBeDisabled();
    expect(screen.getByText('Connect Wahoo in Settings first.')).toBeInTheDocument();
    // HR local zones still render, with no server help.
    expect(screen.getByText(HR_NOTE)).toBeInTheDocument();
  });

  it('leaves the manual push available when the weekly opt-in is off', async () => {
    // The toggle governs the automatic path only (plan D1). A manual push is its
    // own consent, so gating the button on `opt_in` would hide it from the athlete
    // who declined automation — the person who needs it to repair drift.
    getWahooZones.mockResolvedValue(status({ opt_in: false, can_write: true }));

    renderCard();

    expect(
      await screen.findByRole('button', { name: 'Push power zones now' }),
    ).toBeEnabled();
    expect(screen.queryByText(/Turn the sync toggle above on first/)).toBeNull();
  });

  it('explains a missing power-zone scope and points at Settings', async () => {
    getWahooZones.mockResolvedValue(
      status({
        can_write: false,
        error_code: 'missing_scopes',
        error:
          'Wahoo did not grant power-zone access for this connection — reconnect Wahoo to approve it.',
      }),
    );

    renderCard();

    expect(
      await screen.findByText(
        'Wahoo did not grant power-zone access for this connection — reconnect Wahoo to approve it.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Open Settings to reconnect Wahoo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Push power zones now' })).toBeDisabled();
    expect(
      screen.getByText('Reconnect Wahoo to approve power-zone access.'),
    ).toBeInTheDocument();
  });

  it('separates a saved toggle from a failed first push', async () => {
    getWahooZones.mockResolvedValue(status({ opt_in: false }));
    updateCyclingProfile.mockResolvedValue({ id: 'p1' });
    pushWahooZones.mockRejectedValue(new Error('No Wahoo connection found — connect Wahoo in Settings.'));

    renderCard();
    fireEvent.click(
      await screen.findByRole('switch', { name: 'Keep my Wahoo zones in sync with FitTrack' }),
    );

    expect(
      await screen.findByText('Zone sync is on, but the first push did not go through.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('No Wahoo connection found — connect Wahoo in Settings.'),
    ).toBeInTheDocument();
  });

  it('only offers revert when some tracked set has a prior state', async () => {
    getWahooZones.mockResolvedValue(
      status({
        tracked: [
          {
            id: 't2',
            zone_kind: 'power',
            workout_type_family_id: 0,
            workout_type_location_id: 1,
            wahoo_zone_set_id: 78,
            anchor_value: 250,
            boundaries: null,
            has_prior: false,
            pushed_at: '2026-10-10T09:00:00Z',
            last_error: null,
          },
        ],
      }),
    );

    renderCard();

    expect(await screen.findByText(/Sets FitTrack has written to/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Revert to previous Wahoo zones' }),
    ).toBeNull();
  });
});
