export type Readiness = 'green' | 'yellow' | 'red' | 'unknown';

/**
 * Recovery-adapted rest suggestion. Longer when run down, shorter when fresh.
 * Informational only — the UI just highlights once the target is reached.
 */
export function suggestedRestSeconds(
  recoveryScore: number | null | undefined,
  readiness: Readiness = 'unknown'
): number {
  if (readiness === 'red' || (recoveryScore != null && recoveryScore < 34)) return 210;
  if (readiness === 'green' || (recoveryScore != null && recoveryScore > 66)) return 120;
  return 150;
}
