import { apiFetch } from './fetch';
import type { DashboardSummary, MonthlySummaryItem, WeeklyReport, TrainingStreaks, ChartData, ChartParams, YearlySummary, TodaySummary } from './types';

export async function getDashboardSummary(): Promise<DashboardSummary> {
  return apiFetch<DashboardSummary>('/api/v1/dashboard/summary');
}

export async function getDashboardWeeklyReport(): Promise<WeeklyReport> {
  return apiFetch<WeeklyReport>('/api/v1/dashboard/weekly-report');
}

export async function getMonthlySummary(months: number = 6): Promise<MonthlySummaryItem[]> {
  return apiFetch<MonthlySummaryItem[]>(`/api/v1/dashboard/monthly-summary?months=${months}`);
}

export async function getTrainingStreaks(): Promise<TrainingStreaks> {
  return apiFetch<TrainingStreaks>('/api/v1/dashboard/streaks');
}

export async function getChart(chartName: string, params: ChartParams = {}): Promise<ChartData> {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) {
      searchParams.append(key, String(value));
    }
  });
  const query = searchParams.toString();
  return apiFetch<ChartData>(`/api/v1/charts/${chartName}${query ? `?${query}` : ''}`);
}

export async function getYearlySummary(year: number): Promise<YearlySummary> {
  return apiFetch<YearlySummary>(`/api/v1/dashboard/yearly-summary/${year}`);
}

export async function getTodaySummary(): Promise<TodaySummary> {
  return apiFetch<TodaySummary>('/api/v1/dashboard/today');
}
