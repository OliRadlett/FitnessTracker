import { apiFetch } from './fetch';
import type { DeficiencyResponse } from './types';

/**
 * Fetch weakness/deficiency analysis computed over the trailing training window.
 * @param weeks Look-back window in weeks (default 8).
 */
export async function getDeficiency(weeks = 8): Promise<DeficiencyResponse> {
  return apiFetch<DeficiencyResponse>(`/api/v1/deficiency?weeks=${weeks}`);
}
