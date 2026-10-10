/**
 * Phase 2 (plans/ui-redesign-v2.md §2) — four-mode shell.
 * Modes are shells over existing routes; nothing here changes URLs,
 * deep-links, or computation.
 */
export { MODES, matchModeForPath, resolveTrainTarget } from './modeConfig';
export type { ModeConfig, ModeId, ModeNavLink } from './modeConfig';
export { ModeRail } from './ModeRail';
export { useTodayBadge } from './useTodayBadge';
