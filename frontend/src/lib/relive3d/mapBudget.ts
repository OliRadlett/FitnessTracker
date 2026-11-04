/**
 * Client-side 3D map-open budget.
 *
 * This is a UX guard, not the spend cap: the Google Cloud `no spend`
 * spend-cap budget is the hard no-spend layer. The production app should also
 * enforce this server-side (Redis) before mounting the Google map; this client
 * counter keeps the dev/prototype viewer from repeatedly opening maps.
 */

const MONTHLY_MAP_LIMIT = 500;

export interface MapBudget {
  allowed: boolean;
  used: number;
  limit: number;
}

export function claimMapOpen(): MapBudget {
  if (typeof window === 'undefined') {
    return { allowed: false, used: 0, limit: MONTHLY_MAP_LIMIT };
  }
  const month = new Date().toISOString().slice(0, 7);
  const key = `relive3d:map-opens:${month}`;
  let used = 0;
  try {
    const raw = window.localStorage.getItem(key);
    used = raw ? Number(raw) : 0;
  } catch {
    used = 0;
  }
  if (!Number.isFinite(used) || used < 0) used = 0;
  if (used >= MONTHLY_MAP_LIMIT) {
    return { allowed: false, used, limit: MONTHLY_MAP_LIMIT };
  }
  used += 1;
  try {
    window.localStorage.setItem(key, String(used));
  } catch {
    // A blocked storage API should not block the map; the spend cap still holds.
  }
  return { allowed: true, used, limit: MONTHLY_MAP_LIMIT };
}
