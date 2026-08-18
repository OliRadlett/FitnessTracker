import { apiFetch } from './fetch';
import type {
  CyclingProfile,
  CyclingProfileUpdate,
  FtpHistoryEntry,
  FtpHistoryCreate,
  TrainingLoadResponse,
  PowerCurveResponse,
  PowerZonesResponse,
  HrZonesResponse,
  CyclingMetricsSummary,
  PowerVsHrResponse,
  FtpEstimate,
  BackfillStreamsResult,
  LifetimePBsResponse,
  BackfillFtpResult,
} from './types';

export async function getCyclingProfile(): Promise<CyclingProfile> {
  return apiFetch<CyclingProfile>('/api/v1/cycling/profile');
}

export async function updateCyclingProfile(payload: CyclingProfileUpdate): Promise<CyclingProfile> {
  return apiFetch<CyclingProfile>('/api/v1/cycling/profile', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function getFtpHistory(): Promise<FtpHistoryEntry[]> {
  return apiFetch<FtpHistoryEntry[]>('/api/v1/cycling/ftp-history');
}

export async function createFtpHistoryEntry(payload: FtpHistoryCreate): Promise<FtpHistoryEntry> {
  return apiFetch<FtpHistoryEntry>('/api/v1/cycling/ftp-history', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getTrainingLoad(days: number = 90): Promise<TrainingLoadResponse> {
  return apiFetch<TrainingLoadResponse>(`/api/v1/cycling/training-load?days=${days}`);
}

export async function getPowerCurve(days: number = 90): Promise<PowerCurveResponse> {
  return apiFetch<PowerCurveResponse>(`/api/v1/cycling/power-curve?days=${days}`);
}

export async function getPowerZones(days: number = 30): Promise<PowerZonesResponse> {
  return apiFetch<PowerZonesResponse>(`/api/v1/cycling/power-zones?days=${days}`);
}

export async function getHrZones(days: number = 30): Promise<HrZonesResponse> {
  return apiFetch<HrZonesResponse>(`/api/v1/cycling/hr-zones?days=${days}`);
}

export async function getCyclingMetricsSummary(): Promise<CyclingMetricsSummary> {
  return apiFetch<CyclingMetricsSummary>('/api/v1/cycling/metrics-summary');
}

export async function getPowerVsHr(days: number = 90): Promise<PowerVsHrResponse> {
  return apiFetch<PowerVsHrResponse>(`/api/v1/cycling/power-vs-hr?days=${days}`);
}

export async function recalculateTss(days: number = 90): Promise<{ updated: number; total_checked: number }> {
  return apiFetch(`/api/v1/cycling/recalculate-tss?days=${days}`, { method: 'POST' });
}

export async function estimateFtp(days: number = 90, accept: boolean = false): Promise<FtpEstimate> {
  return apiFetch<FtpEstimate>(`/api/v1/cycling/estimate-ftp?days=${days}&accept=${accept}`, {
    method: 'POST',
  });
}

export async function backfillStreams(days: number = 90, limit: number = 20): Promise<BackfillStreamsResult> {
  return apiFetch<BackfillStreamsResult>(`/api/v1/cycling/backfill-streams?days=${days}&limit=${limit}`, {
    method: 'POST',
  });
}

export async function getLifetimePBs(): Promise<LifetimePBsResponse> {
  return apiFetch<LifetimePBsResponse>('/api/v1/cycling/lifetime-pbs');
}

export async function backfillFtpHistory(months: number = 12): Promise<BackfillFtpResult> {
  return apiFetch<BackfillFtpResult>(`/api/v1/cycling/backfill-ftp-history?months=${months}`, {
    method: 'POST',
  });
}
