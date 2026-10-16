'use client';

// Wahoo power-zone sync card (plans/wahoo-zone-sync.md).
//
// FitTrack's FTP is pushed into the athlete's Wahoo power zone sets so the ELEMNT
// colours the live zone against current boundaries instead of a stale FTP. The
// status endpoint *degrades*: a Wahoo-side problem arrives as `error_code`/`error`
// inside a 200 payload, so this card renders the local zones and the reason rather
// than an error page.
//
// Heart-rate zones have no writable Wahoo surface at all (no endpoint, no scope),
// so the HR section is read-only and says so in Wahoo's own words (`hr_note`).
// There is deliberately no HR push control.

import React, { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { ErrorState } from '@/components/ui/ErrorState';
import {
  getWahooZones,
  pushWahooZones,
  revertWahooZones,
  updateCyclingProfile,
  useAuthFetch,
} from '@/lib/api';
import type {
  LocalZoneSet,
  WahooPowerZoneSet,
  WahooZonesPushResult,
  WahooZonesStatus,
  ZoneDrift,
} from '@/lib/api';
import { formatRelativeTime } from '@/lib/utils';

const WAHOO_ZONES_KEY = ['wahoo-zones'] as const;

/** Wahoo's `workout_type_location_id`: 0 indoor, 1 outdoor, anything else unattributed. */
const LOCATION_LABELS: Record<number, string> = { 0: 'Indoor', 1: 'Outdoor' };

function locationLabel(locationId: number | null | undefined): string {
  if (locationId == null) return 'Unknown';
  return LOCATION_LABELS[locationId] ?? 'Unknown';
}

/** Skip reasons are `WahooZoneError.code` values; say what each one means in words. */
const SKIP_REASON_TEXT: Record<string, string> = {
  already_current: 'already matched your FTP',
  no_anchor: "Wahoo reported no FTP for it, so its boundaries can't be rescaled",
  rejected: 'Wahoo rejected the change',
  set_gone: 'the set no longer exists on Wahoo',
  missing_scopes: "we don't have power-zone access yet",
  needs_reauth: 'the Wahoo connection needs re-authorising',
  transient: 'Wahoo was not reachable',
};

function skipText(reason: string): string {
  return SKIP_REASON_TEXT[reason] ?? reason;
}

/** Wahoo set ids mean nothing to the athlete — name the set they belong to. */
function setLabel(id: number, sets: WahooPowerZoneSet[]): string {
  const match = sets.find((set) => set.id === id);
  return match ? `${locationLabel(match.workout_type_location_id)} set` : `Set ${id}`;
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function watts(value: number | null): string {
  return value == null ? '—' : `${Math.round(value)} W`;
}

/**
 * `delta` is `wahoo − local`, so the sign is the actionable part: a device set
 * *below* FitTrack is the stale case the feature exists to fix.
 */
function driftSentence(delta: number | null): string {
  if (delta == null) return 'nothing to compare';
  if (delta === 0) return 'in step';
  const abs = Math.abs(delta);
  const amount = Number.isInteger(abs) ? String(abs) : abs.toFixed(1);
  return delta < 0 ? `your device is ${amount} W behind` : `${amount} W ahead`;
}

function driftTone(delta: number | null): string {
  if (delta == null) return 'text-muted';
  return delta === 0 ? 'text-positive' : 'text-warning';
}

/** One-line outcome of a push, never dressed up as success when nothing was written. */
function pushHeadline(result: WahooZonesPushResult): { text: string; tone: string } {
  const wrote = result.updated.length + result.created.length;
  const ftp = result.ftp == null ? '' : ` at FTP ${Math.round(result.ftp)} W`;
  if (wrote === 0) {
    return { text: 'Nothing was written to Wahoo.', tone: 'text-warning' };
  }
  const parts: string[] = [];
  if (result.updated.length > 0) {
    parts.push(`${result.updated.length} set${result.updated.length === 1 ? '' : 's'} updated`);
  }
  if (result.created.length > 0) {
    parts.push(`${result.created.length} set${result.created.length === 1 ? '' : 's'} created`);
  }
  return { text: `Wahoo zones synced — ${parts.join(', ')}${ftp}.`, tone: 'text-positive' };
}

/** Why the push button is disabled, in the order the athlete can act on. */
function pushDisabledReason(status: WahooZonesStatus): string | null {
  if (status.can_write) return null;
  if (!status.connected) return 'Connect Wahoo in Settings first.';
  if (status.error_code === 'needs_reauth') return 'Reconnect Wahoo in Settings first.';
  if (status.error_code === 'missing_scopes') {
    return 'Reconnect Wahoo to approve power-zone access.';
  }
  if (status.error_code) return status.error ?? 'Wahoo is unavailable right now.';
  // Deliberately *not* an opt-in check: the toggle governs only the weekly automatic
  // push, and a manual push is its own consent — so the button stays available to
  // someone who declined automation, which is exactly who needs it to repair drift.
  const ftp = status.local_sets.find((set) => set.zone_kind === 'power')?.anchor_value ?? null;
  if (ftp == null) return 'Set your FTP in Profile Settings first.';
  return 'Pushing is unavailable right now.';
}

type ToggleOutcome =
  | { ok: true; enabled: boolean; push: WahooZonesPushResult | null }
  | { ok: false; phase: 'save' | 'push'; message: string };

export function WahooZonesCard() {
  const { authFetch, token } = useAuthFetch();
  const queryClient = useQueryClient();
  const [pushResult, setPushResult] = useState<WahooZonesPushResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toggleNote, setToggleNote] = useState<string | null>(null);
  const [revertNote, setRevertNote] = useState<string | null>(null);

  const {
    data: status,
    isLoading,
    isError,
    refetch,
  } = useQuery<WahooZonesStatus>({
    queryKey: WAHOO_ZONES_KEY,
    queryFn: () => getWahooZones(authFetch),
    // Required: without it the query fires before `session.backendToken` is ready,
    // 401s, and the service worker swallows the request (AGENTS.md pitfall 11).
    enabled: !!token,
    staleTime: 60_000,
  });

  const invalidateStatus = () => {
    void queryClient.invalidateQueries({ queryKey: WAHOO_ZONES_KEY });
  };

  const pushMutation = useMutation({
    mutationFn: () => pushWahooZones(authFetch),
    onSuccess: (result) => {
      setPushResult(result);
      setActionError(null);
      setRevertNote(null);
      invalidateStatus();
    },
    onError: (error: Error) => {
      setPushResult(null);
      setActionError(errorText(error, "Couldn't push your zones to Wahoo."));
      invalidateStatus();
    },
  });

  const revertMutation = useMutation({
    mutationFn: () => revertWahooZones(authFetch),
    onSuccess: (result) => {
      setActionError(null);
      setPushResult(null);
      const count = result.reverted.length;
      const anchor =
        result.anchor_value == null ? '' : ` to FTP ${Math.round(result.anchor_value)} W`;
      setRevertNote(
        count === 0
          ? 'Nothing to restore — Wahoo has no earlier zone state for these sets.'
          : `Restored ${count} set${count === 1 ? '' : 's'}${anchor}, the values they had before FitTrack wrote them.`
      );
      invalidateStatus();
    },
    onError: (error: Error) => {
      setActionError(errorText(error, "Couldn't restore your previous Wahoo zones."));
    },
  });

  /* The toggle: PATCH the opt-in first, then push. The order is deliberate — the
     setting is the durable part, so a failed first push must not lose it. The
     backend also queues a push on the off→on transition, but leaving the first
     sync entirely to that queue would mean waiting for the weekly task. */
  const toggleMutation = useMutation<ToggleOutcome, Error, boolean>({
    mutationFn: async (next: boolean): Promise<ToggleOutcome> => {
      try {
        await updateCyclingProfile(authFetch, { push_wahoo_zones: next });
      } catch (error) {
        return {
          ok: false,
          phase: 'save',
          message: errorText(error, "Couldn't save the zone-sync setting."),
        };
      }
      if (!next) return { ok: true, enabled: false, push: null };
      try {
        return { ok: true, enabled: true, push: await pushWahooZones(authFetch) };
      } catch (error) {
        return {
          ok: false,
          phase: 'push',
          message: errorText(error, "Couldn't push your zones to Wahoo."),
        };
      }
    },
    onSuccess: (outcome) => {
      invalidateStatus();
      void queryClient.invalidateQueries({ queryKey: ['cycling-profile'] });
      if (!outcome.ok) {
        setActionError(outcome.message);
        setToggleNote(
          outcome.phase === 'push'
            ? 'Zone sync is on, but the first push did not go through.'
            : null
        );
        return;
      }
      setActionError(null);
      if (!outcome.enabled) {
        setPushResult(null);
        setToggleNote('Zone sync switched off — zones stay as they are on Wahoo.');
        return;
      }
      setToggleNote('Zone sync is on.');
      if (outcome.push) setPushResult(outcome.push);
    },
  });

  const hrSet: LocalZoneSet | null =
    status?.local_sets.find((set) => set.zone_kind === 'heart_rate') ?? null;
  const powerAnchor = status?.local_sets.find((set) => set.zone_kind === 'power')?.anchor_value ?? null;
  const pushBlockedReason = status ? pushDisabledReason(status) : null;
  const canRevert = !!status?.tracked.some((row) => row.has_prior);
  const lastPush = (status?.tracked ?? []).reduce<string | null>(
    (latest, row) =>
      row.pushed_at && (!latest || row.pushed_at > latest) ? row.pushed_at : latest,
    null
  );
  const drift: ZoneDrift[] = status?.drift ?? [];
  const pushSummary = pushResult ? pushHeadline(pushResult) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Wahoo power zones</CardTitle>
      </CardHeader>

      {isLoading && (
        <div className="animate-pulse space-y-2" aria-hidden="true">
          <div className="h-4 bg-surface-light rounded w-2/3" />
          <div className="h-4 bg-surface-light rounded w-1/3" />
        </div>
      )}

      {isError && (
        <ErrorState
          variant="inline"
          message="Couldn't load your Wahoo zone status."
          onRetry={() => void refetch()}
        />
      )}

      {status && (
        <div className="space-y-5">
          {/* ── Connection / error state ─────────────────────────────────── */}
          {(status.error || !status.connected) && (
            <div className="rounded-lg border border-warning/30 bg-warning/5 p-3">
              <p className="text-sm text-warning">
                {status.error ??
                  'Wahoo is not connected, so FitTrack cannot see or update your zone sets.'}
              </p>
              {(!status.connected ||
                status.error_code === 'needs_reauth' ||
                status.error_code === 'missing_scopes') && (
                <Link
                  href="/settings"
                  className="mt-2 inline-flex min-h-[44px] items-center text-sm font-medium text-accent hover:text-accent/80 underline underline-offset-2"
                >
                  {status.error_code === 'missing_scopes'
                    ? 'Open Settings to reconnect Wahoo'
                    : 'Open Settings to connect Wahoo'}
                </Link>
              )}
            </div>
          )}

          {/* ── Opt-in toggle ────────────────────────────────────────────── */}
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                Keep my Wahoo zones in sync with FitTrack
              </p>
              <p className="text-xs text-muted mt-0.5">
                Pushes your FTP and the rescaled zone boundaries to the head unit, so the live
                zone it shows is coloured against your current threshold. This applies to the{' '}
                <span className="text-foreground">weekly automatic</span> FTP update.
              </p>
              {toggleNote && <p className="text-xs text-muted mt-1">{toggleNote}</p>}
            </div>
            <button
              onClick={() => toggleMutation.mutate(!status.opt_in)}
              disabled={toggleMutation.isPending}
              role="switch"
              aria-checked={status.opt_in}
              aria-label="Keep my Wahoo zones in sync with FitTrack"
              className={`relative inline-flex h-6 w-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full transition-colors ${
                status.opt_in ? 'bg-accent' : 'bg-surface-light'
              } ${toggleMutation.isPending ? 'opacity-50' : ''}`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  status.opt_in ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* ── Actions ──────────────────────────────────────────────────── */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <button
              onClick={() => pushMutation.mutate()}
              disabled={!status.can_write || pushMutation.isPending}
              className="px-4 py-2 min-h-[44px] text-sm bg-accent text-white font-medium rounded-lg hover:bg-accent/80 transition-colors disabled:opacity-50"
            >
              {pushMutation.isPending ? 'Pushing…' : 'Push power zones now'}
            </button>
            {canRevert && (
              <button
                onClick={() => revertMutation.mutate()}
                disabled={revertMutation.isPending || toggleMutation.isPending}
                className="px-4 py-2 min-h-[44px] text-sm bg-surface-light text-foreground border border-surface-light rounded-lg hover:bg-surface-light/70 transition-colors disabled:opacity-50"
              >
                {revertMutation.isPending ? 'Restoring…' : 'Revert to previous Wahoo zones'}
              </button>
            )}
            <span className="text-xs text-muted sm:ml-auto">
              Last push: {lastPush ? formatRelativeTime(lastPush) : 'never'}
            </span>
          </div>

          {pushBlockedReason && (
            <p className="text-xs text-muted -mt-3">{pushBlockedReason}</p>
          )}

          {actionError && (
            <p className="text-xs text-warning" role="status">
              {actionError}
            </p>
          )}

          {revertNote && <p className="text-xs text-positive">{revertNote}</p>}

          {/* ── Push outcome (skip reasons are never dressed as success) ─── */}
          {pushResult && pushSummary && (
            <div className="rounded-lg border border-surface-light/40 bg-surface-light/10 p-3 space-y-1">
              <p className={`text-sm ${pushSummary.tone}`}>{pushSummary.text}</p>
              {pushResult.reason === 'not_opted_in' && (
                <p className="text-xs text-muted">
                  Zone sync is switched off, so nothing was pushed.
                </p>
              )}
              {pushResult.skipped.length > 0 && (
                <ul className="text-xs text-muted space-y-0.5">
                  {pushResult.skipped.map((skip) => (
                    <li key={`${skip.id}-${skip.reason}`}>
                      {setLabel(skip.id, status.wahoo_sets)} left alone — {skipText(skip.reason)}.
                    </li>
                  ))}
                </ul>
              )}
              {pushResult.foreign.length > 0 && (
                <p className="text-xs text-muted">
                  {pushResult.foreign.length === 1
                    ? 'A set managed by another app was left alone.'
                    : `${pushResult.foreign.length} sets managed by another app were left alone.`}
                </p>
              )}
            </div>
          )}

          {/* ── Drift ────────────────────────────────────────────────────── */}
          <div>
            <p className="text-sm font-medium text-foreground">FTP on your head unit</p>
            <p className="text-xs text-muted mt-0.5">
              FitTrack&apos;s FTP against the FTP your Wahoo zone sets currently use. A device
              that is <span className="text-foreground">behind</span> is still colouring zones
              against an older, lower threshold.
            </p>
            {drift.length === 0 ? (
              <p className="text-xs text-muted mt-2">
                No comparable zone sets yet — push once and the difference will show here.
              </p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted">
                      <th className="text-left font-normal pb-1">Set</th>
                      <th className="text-right font-normal pb-1 pl-3">FitTrack</th>
                      <th className="text-right font-normal pb-1 pl-3">Wahoo</th>
                      <th className="text-left font-normal pb-1 pl-3">Difference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drift.map((row, index) => (
                      <tr
                        key={`${row.zone_kind}-${row.workout_type_location_id ?? 'none'}-${row.wahoo_zone_set_id ?? index}`}
                        className="border-t border-surface-light/30"
                      >
                        <td className="py-1.5 pr-2 text-muted whitespace-nowrap">
                          {locationLabel(row.workout_type_location_id)}
                        </td>
                        <td className="py-1.5 pl-3 text-right tabular-nums">
                          {watts(row.local_anchor)}
                        </td>
                        <td className="py-1.5 pl-3 text-right tabular-nums">
                          {watts(row.wahoo_anchor)}
                        </td>
                        <td className={`py-1.5 pl-3 text-xs ${driftTone(row.delta)}`}>
                          {driftSentence(row.delta)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Sets we manage ───────────────────────────────────────────── */}
          {status.tracked.length > 0 && (
            <div>
              <p className="text-xs text-muted">
                Sets FitTrack has written to
                {lastPush ? ` · last pushed ${formatRelativeTime(lastPush)}` : ''}
              </p>
              <ul className="mt-1 space-y-1">
                {status.tracked.map((row) => (
                  <li key={row.id} className="text-xs text-muted">
                    <span className="text-foreground">
                      {locationLabel(row.workout_type_location_id)}
                    </span>
                    {' · last pushed FTP '}
                    {watts(row.anchor_value)}
                    {row.has_prior ? ' · can be reverted' : ''}
                    {row.last_error && (
                      <span className="block text-warning mt-0.5">{row.last_error}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ── Heart rate: read-only, always visible, no push control ───── */}
          <div className="pt-4 border-t border-surface-light/30">
            <p className="text-sm font-medium text-foreground">Heart rate zones</p>
            <p className="text-xs text-muted mt-0.5">
              Read only — FitTrack cannot write these to Wahoo.
            </p>
            <p className="text-xs text-muted mt-1">{status.hr_note}</p>
            {hrSet && hrSet.zones.length > 0 ? (
              <ul className="mt-2 space-y-0.5">
                {hrSet.zones.map((zone) => (
                  <li key={zone.zone} className="flex items-center gap-2 text-xs">
                    <span className="w-28 shrink-0 text-muted truncate">{zone.zone_name}</span>
                    <span className="tabular-nums text-foreground">
                      {Math.round(zone.lower)}–{zone.upper == null ? '∞' : Math.round(zone.upper)} bpm
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted mt-2">
                {hrSet?.anchor_value == null
                  ? 'FitTrack has no LTHR set, so there are no heart-rate zones to show.'
                  : 'No heart-rate zones to show.'}
              </p>
            )}
          </div>

          {/* The local power anchor: the "no FTP yet" case the copy above refers to. */}
          {powerAnchor == null && (
            <p className="text-xs text-muted">
              Set your FTP in Profile Settings to push power zones.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
