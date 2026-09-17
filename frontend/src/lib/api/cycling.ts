// Cycling API client — power PRs, profile, and power curve functions.

import type {
  CyclingProfile,
  CyclingProfileUpdate,
  CyclingPowerRecord,
  CyclingPowerRecordCreate,
  FtpHistoryEntry,
  FtpHistoryCreate,
  PowerCurveResponse,
  LifetimePBsResponse,
  PrCheckRequest,
  PrCheckResponse,
  CyclingMetricsSummary,
} from './types';

type AuthFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

// ─── Power PRs ──────────────────────────────────────────────────────────────

export async function getCyclingPRs(authFetch: AuthFetch): Promise<CyclingPowerRecord[]> {
  return authFetch<CyclingPowerRecord[]>('/api/v1/cycling/prs');
}

export async function createCyclingPR(
  authFetch: AuthFetch,
  data: CyclingPowerRecordCreate
): Promise<CyclingPowerRecord> {
  return authFetch<CyclingPowerRecord>('/api/v1/cycling/prs', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function checkCyclingPRs(
  authFetch: AuthFetch,
  data?: PrCheckRequest
): Promise<PrCheckResponse> {
  return authFetch<PrCheckResponse>('/api/v1/cycling/prs/check', {
    method: 'POST',
    body: JSON.stringify(data ?? {}),
  });
}

// ─── Cycling Profile ─────────────────────────────────────────────────────────

export async function getCyclingProfile(authFetch: AuthFetch): Promise<CyclingProfile> {
  return authFetch<CyclingProfile>('/api/v1/cycling/profile');
}

export async function updateCyclingProfile(
  authFetch: AuthFetch,
  data: CyclingProfileUpdate,
  ftpHistory?: FtpHistoryCreate
): Promise<CyclingProfile> {
  const body: Record<string, unknown> = { ...data };
  if (ftpHistory) {
    body.ftp_history = ftpHistory;
  }
  return authFetch<CyclingProfile>('/api/v1/cycling/profile', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

// ─── FTP History ─────────────────────────────────────────────────────────────

export async function getFtpHistory(authFetch: AuthFetch): Promise<FtpHistoryEntry[]> {
  return authFetch<FtpHistoryEntry[]>('/api/v1/cycling/ftp-history');
}

export async function addFtpHistory(
  authFetch: AuthFetch,
  data: FtpHistoryCreate
): Promise<FtpHistoryEntry> {
  return authFetch<FtpHistoryEntry>('/api/v1/cycling/ftp-history', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ─── Power Curve ─────────────────────────────────────────────────────────────

export async function getPowerCurve(authFetch: AuthFetch, days = 90): Promise<PowerCurveResponse> {
  return authFetch<PowerCurveResponse>(`/api/v1/cycling/power-curve?days=${days}`);
}

export async function getLifetimePBs(authFetch: AuthFetch): Promise<LifetimePBsResponse> {
  return authFetch<LifetimePBsResponse>('/api/v1/cycling/lifetime-pbs');
}

// ─── Cycling Metrics Summary ─────────────────────────────────────────────────

export async function getCyclingMetricsSummary(authFetch: AuthFetch): Promise<CyclingMetricsSummary> {
  return authFetch<CyclingMetricsSummary>('/api/v1/cycling/metrics-summary');
}
