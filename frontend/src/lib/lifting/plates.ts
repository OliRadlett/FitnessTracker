/** Standard metric plates, heaviest first — greedy loading is optimal. */
export const STANDARD_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];

export interface PlateLoad {
  plate: number;
  count: number;
}

export interface PlateResult {
  /** Load per side of the bar (kg). */
  perSide: number;
  counts: PlateLoad[];
  /** Per-side remainder that no available plate can cover. */
  leftover: number;
  totalPlates: number;
}

/** Per-side plate loading for a target barbell weight. */
export function computePlates(
  weightKg: number,
  barWeight: number,
  plates: number[] = STANDARD_PLATES
): PlateResult {
  const perSide = Math.max(0, (weightKg - barWeight) / 2);
  let remaining = perSide;
  const counts: PlateLoad[] = [];
  for (const plate of plates) {
    const count = Math.floor((remaining + 1e-9) / plate);
    if (count > 0) {
      counts.push({ plate, count });
      remaining = +(remaining - count * plate).toFixed(4);
    }
  }
  return {
    perSide,
    counts,
    leftover: remaining,
    totalPlates: counts.reduce((n, c) => n + c.count, 0),
  };
}
