// ─── Wahoo zone sync ──────────────────────────────────────────────────────────
//
// Hand-written (like `types/notifications.ts`), because the schemas ship with the
// backend before the next codegen run: `WahooZonesStatus`, `LocalZoneSet`,
// `WahooPowerZoneSet`, `WahooZoneSetTracked`, `ZoneDrift` and the push/revert
// results also appear in `types/generated.ts` at the next `npm run codegen`
// (`openapi-typescript` against a live backend). Keep the two in step.
//
// Endpoints (`lib/api/cycling.ts`):
//   GET  /api/v1/cycling/wahoo-zones
//   POST /api/v1/cycling/wahoo-zones/push
//   POST /api/v1/cycling/wahoo-zones/revert

export type WahooZoneKind = 'power' | 'heart_rate';
export type WahooZoneAnchorKind = 'ftp' | 'lthr';

/** One zone of a FitTrack zone model, in its own units (W or bpm). */
export interface LocalZoneBoundary {
  zone: string;
  zone_name: string;
  lower: number;
  upper: number | null;
}

/** What FitTrack currently believes, for one zone kind. */
export interface LocalZoneSet {
  zone_kind: WahooZoneKind;
  anchor_kind: WahooZoneAnchorKind;
  anchor_value: number | null;
  zones: LocalZoneBoundary[];
}

/**
 * A power zone set as Wahoo returns it — deliberately faithful, not tidied.
 * `provenance` keeps four cases distinct where a `third_party` boolean could not:
 * "not the Wahoo app" covers our own app's sets, another integration's, and sets we
 * cannot identify at all — and our own sets sit above the third-party floor too.
 */
export interface WahooPowerZoneSet {
  id: number;
  workout_type_family_id: number | null;
  workout_type_location_id: number | null;
  ftp: number | null;
  zone_count: number | null;
  zones: number[];
  fitness_app_id: number | null;
  /** Wire field is `originator_type_id`; display only, never read for policy. */
  originator_type_id: number | null;
  /**
   * `ours` | `platform` | `third_party` | `unknown`. Not a boolean: "not the Wahoo
   * app" covers three situations, and our own app's sets sit above the third-party
   * floor too — so `fitness_app_id > 1000` alone cannot mean "someone else's".
   */
  provenance: string | null;
  updated_at: string | null;
}

/** Our bookkeeping row for a set we have written to. */
export interface WahooZoneSetTracked {
  id: string;
  zone_kind: string;
  workout_type_family_id: number;
  workout_type_location_id: number;
  wahoo_zone_set_id: number | null;
  anchor_value: number | null;
  boundaries: unknown | null;
  /** A snapshot exists, so this set can be reverted. */
  has_prior: boolean;
  pushed_at: string | null;
  last_error: string | null;
}

/** Local vs Wahoo anchor for one set. `delta` is `wahoo − local`. */
export interface ZoneDrift {
  zone_kind: string;
  workout_type_location_id: number | null;
  wahoo_zone_set_id: number | null;
  local_anchor: number | null;
  wahoo_anchor: number | null;
  delta: number | null;
}

/** A set we deliberately did not write to, and why. */
export interface WahooZoneSkipped {
  id: number;
  /**
   * Free-form on the wire (it carries `WahooZoneError.code`), but the known set is
   * `already_current | no_anchor | rejected | set_gone | missing_scopes |
   * needs_reauth | transient`.
   */
  reason: string;
}

/** Outcome of a push. Reports silences, not just successes. */
export interface WahooZonesPushResult {
  ftp: number | null;
  updated: number[];
  created: number[];
  skipped: WahooZoneSkipped[];
  /** Sets owned by another third-party app, which we refuse to fight over. */
  foreign: number[];
  /** Set when nothing was attempted at all, e.g. the athlete opted out. */
  reason: string | null;
}

export interface WahooZonesRevertResult {
  anchor_value: number | null;
  reverted: number[];
  missing: number[];
}

/** `error_code` values `read_wahoo_zones` can produce; anything else is unexpected. */
export type WahooZonesErrorCode =
  | 'no_connection'
  | 'needs_reauth'
  | 'missing_scopes'
  | 'transient'
  | 'http_error';

export interface WahooZonesStatus {
  connected: boolean;
  /** "active" | "needs_reauth" */
  connection_status: string | null;
  /** The `push_wahoo_zones` toggle — governs the *weekly automatic* path only. */
  opt_in: boolean;
  /**
   * May the athlete press "Push now" right now: connected + FTP set + no Wahoo-side
   * error. Deliberately **not** gated on `opt_in`, since a manual push is its own
   * consent — gating it would hide the button from the athlete who declined
   * automation, i.e. the one who needs it to repair drift.
   */
  can_write: boolean;
  /** Always false: Wahoo exposes no heart-rate zone surface at all. */
  hr_write_supported: boolean;
  /** Ready-made explanation for the HR section — display it, don't reinvent it. */
  hr_note: string;
  local_sets: LocalZoneSet[];
  wahoo_sets: WahooPowerZoneSet[];
  tracked: WahooZoneSetTracked[];
  drift: ZoneDrift[];
  error_code: WahooZonesErrorCode | null;
  /** Human-readable and already written — display verbatim. */
  error: string | null;
}
