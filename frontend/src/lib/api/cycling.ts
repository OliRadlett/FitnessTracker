// Cycling profile writes and the Wahoo power-zone sync surface.
//
// The status/push/revert endpoints degrade rather than fail (a Wahoo-side problem
// comes back as `error_code`/`error` inside a 200 payload), so the card can always
// render something true. The push/revert calls *do* raise on the whole-operation
// conditions (409 no connection, 403 missing scope, 422 no FTP) — the thrown
// `ApiError.message` is the backend's `detail`, which is already user-facing copy.

import type {
  CyclingProfile,
  CyclingProfileUpdate,
  WahooZonesPushResult,
  WahooZonesRevertResult,
  WahooZonesStatus,
} from './types';

type AuthFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

/**
 * PATCH body for `/api/v1/cycling/profile`.
 *
 * `push_wahoo_zones` is the zone-sync opt-in. It is a delta on the hand-maintained
 * `CyclingProfileUpdate` (the generated schema gains the field at the next
 * `npm run codegen`); keeping it here avoids editing the shared cycling types for a
 * single-writer field.
 */
export type CyclingProfilePatch = CyclingProfileUpdate & { push_wahoo_zones?: boolean };

/** FitTrack's zones, the athlete's Wahoo sets, and the difference between them. */
export async function getWahooZones(authFetch: AuthFetch): Promise<WahooZonesStatus> {
  return authFetch<WahooZonesStatus>('/api/v1/cycling/wahoo-zones');
}

/**
 * Write FitTrack's FTP into the athlete's Wahoo power zone sets.
 *
 * Forced server-side: a manual press re-pushes a set whose anchor already matches,
 * because the athlete may have changed the zones in the Wahoo app since we looked.
 */
export async function pushWahooZones(authFetch: AuthFetch): Promise<WahooZonesPushResult> {
  return authFetch<WahooZonesPushResult>('/api/v1/cycling/wahoo-zones/push', {
    method: 'POST',
  });
}

/** Restore each set to the state captured before our first write to it. */
export async function revertWahooZones(authFetch: AuthFetch): Promise<WahooZonesRevertResult> {
  return authFetch<WahooZonesRevertResult>('/api/v1/cycling/wahoo-zones/revert', {
    method: 'POST',
  });
}

/** Partial update of the cycling profile (FTP, weight, LTHR, home location, opt-in). */
export async function updateCyclingProfile(
  authFetch: AuthFetch,
  patch: CyclingProfilePatch
): Promise<CyclingProfile> {
  return authFetch<CyclingProfile>('/api/v1/cycling/profile', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}
