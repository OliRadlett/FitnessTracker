/**
 * Custom Playwright test fixture that provides an authenticated page
 * with mocked NextAuth session and backend API responses.
 *
 * Usage:
 *   import { test, expect } from './fixtures/authenticated-test';
 *
 *   test('my test', async ({ authenticatedPage: page }) => {
 *     await page.goto('/dashboard');
 *     // ... assertions
 *   });
 *
 * To override a specific API mock for a single test, call page.route()
 * with a more specific pattern before the catch-all handler picks it up,
 * or re-register routes after the fixture sets them up.
 */

import { test as base, type Page, type Route } from '@playwright/test';
import * as mockData from './mock-data';

// ─── Mock session response ──────────────────────────────────────────────────

const MOCK_SESSION = {
  user: {
    name: 'Test User',
    email: 'test@example.com',
    image: null,
  },
  expires: '2099-12-31T23:59:59.999Z',
  backendToken: 'test-jwt-token',
};

// ─── API route handler map ──────────────────────────────────────────────────

type ApiHandler = (route: Route) => void;

/**
 * Default API mock handlers. Maps URL patterns to mock responses.
 * Each key is a substring matched against the request URL.
 */
const defaultApiHandlers: [string, ApiHandler][] = [
  // Auth session
  ['api/auth/session', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_SESSION),
    });
  }],

  // Dashboard
  ['api/v1/dashboard/today', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify(mockData.mockTodaySummary) });
  }],
  ['api/v1/dashboard/summary', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify(mockData.mockDashboardSummary) });
  }],
  ['api/v1/dashboard/weekly-report', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify(mockData.mockWeeklyReport) });
  }],
  ['api/v1/dashboard/monthly-summary', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify(mockData.mockMonthlySummary) });
  }],
  ['api/v1/dashboard/streaks', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify(mockData.mockTrainingStreaks) });
  }],
  ['api/v1/dashboard/yearly-summary', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify(mockData.mockYearlySummary) });
  }],
  ['api/v1/dashboard/whoop-weekly', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify(mockData.mockWhoopWeekly) });
  }],

  // Calendar (MUST come before activities to avoid substring collision)
  ['api/v1/activities/calendar', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify(mockData.mockCalendarData) });
  }],

  // Activities
  ['api/v1/activities', (route) => {
    const url = route.request().url();
    if (url.includes('/api/v1/activities/')) {
      // Single activity detail
      route.fulfill({ status: 200, body: JSON.stringify(mockData.mockActivities[0]) });
    } else {
      route.fulfill({ status: 200, body: JSON.stringify(mockData.mockActivities) });
    }
  }],

  // Lifting
  ['api/v1/lifting/sessions', (route) => {
    const url = route.request().url();
    const match = url.match(/\/api\/v1\/lifting\/sessions\/([a-z0-9-]+)/);
    if (match) {
      const session = mockData.mockLiftingSessions.find(s => s.id === match[1]);
      route.fulfill({ status: 200, body: JSON.stringify(session || mockData.mockLiftingSessions[0]) });
    } else {
      route.fulfill({ status: 200, body: JSON.stringify(mockData.mockLiftingSessions) });
    }
  }],
  ['api/v1/lifting/prs', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify(mockData.mockPersonalRecords) });
  }],
  ['api/v1/lifting/volume-trends', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify(mockData.mockVolumeTrends) });
  }],
  ['api/v1/lifting/warmup-templates', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify(mockData.mockWarmupTemplates) });
  }],
  ['api/v1/lifting/exercise-suggestions', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify(mockData.mockExerciseSuggestions) });
  }],

  // Cycling
  ['api/v1/cycling/profile', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify(mockData.mockCyclingProfile) });
  }],
  ['api/v1/cycling/metrics-summary', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify(mockData.mockCyclingMetrics) });
  }],
  ['api/v1/cycling/training-load', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify(mockData.mockTrainingLoad) });
  }],
  ['api/v1/cycling/power-curve', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify(mockData.mockPowerCurve) });
  }],
  ['api/v1/cycling/power-zones', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify(mockData.mockPowerZones) });
  }],
  ['api/v1/cycling/hr-zones', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify({ lthr: 172, zones: [], total_time_seconds: 0 }) });
  }],
  // vo2max-history MUST come before vo2max to avoid substring collision
  ['api/v1/cycling/vo2max-history', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify(mockData.mockVo2maxHistory) });
  }],
  ['api/v1/cycling/vo2max', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify(mockData.mockVo2max) });
  }],
  ['api/v1/cycling/decoupling', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify(mockData.mockDecouplingHistory) });
  }],
  ['api/v1/cycling/ftp-history', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify(mockData.mockFtpHistory) });
  }],
  ['api/v1/cycling/lifetime-pbs', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify(mockData.mockLifetimePBs) });
  }],
  ['api/v1/cycling/power-vs-hr', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify({ data: [] }) });
  }],
  ['api/v1/cycling/estimate-ftp', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify(mockData.mockFtpEstimate) });
  }],
  ['api/v1/cycling/llm-analysis/latest', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify(mockData.mockLlmAnalysis) });
  }],
  ['api/v1/cycling/llm-analysis/on-demand', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify(mockData.mockLlmAnalysis) });
  }],

  // Routes
  ['api/v1/routes/', (route) => {
    const url = route.request().url();
    const routeMatch = url.match(/\/api\/v1\/routes\/([a-z0-9-]+)$/);
    if (routeMatch && routeMatch[1] !== 'sync' && routeMatch[1] !== 'upload-gpx') {
      route.fulfill({ status: 200, body: JSON.stringify(mockData.mockRouteDetail) });
    } else {
      route.fulfill({ status: 200, body: JSON.stringify(mockData.mockRoutes) });
    }
  }],

  // Goals
  ['api/v1/goals', (route) => {
    if (route.request().method() === 'POST') {
      route.fulfill({ status: 201, body: JSON.stringify(mockData.mockGoals[0]) });
    } else {
      route.fulfill({ status: 200, body: JSON.stringify(mockData.mockGoals) });
    }
  }],

  // Events
  ['api/v1/events', (route) => {
    if (route.request().method() === 'POST') {
      route.fulfill({ status: 201, body: JSON.stringify(mockData.mockEvents[0]) });
    } else {
      route.fulfill({ status: 200, body: JSON.stringify(mockData.mockEvents) });
    }
  }],

  // Training Plans — generate MUST come before general to avoid substring collision
  ['api/v1/training-plans/generate', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify(mockData.mockTrainingPlan) });
  }],
  ['api/v1/training-plans', (route) => {
    const url = route.request().url();
    const planMatch = url.match(/\/api\/v1\/training-plans\/([a-z0-9-]+)$/);
    if (planMatch && planMatch[1] !== 'generate') {
      route.fulfill({ status: 200, body: JSON.stringify(mockData.mockTrainingPlan) });
    } else {
      route.fulfill({ status: 200, body: JSON.stringify(mockData.mockTrainingPlanSummaries) });
    }
  }],

  // Health / Metrics
  ['api/v1/metrics/readiness', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify(mockData.mockReadiness) });
  }],
  ['api/v1/metrics/respiratory-rate', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify(mockData.mockRespiratoryRate) });
  }],
  ['api/v1/metrics/health-alerts', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify(mockData.mockHealthAlerts) });
  }],
  ['api/v1/metrics/health-alerts/analyze', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify({ analysis_results: [] }) });
  }],

  // Connections
  ['api/v1/connections/', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify(mockData.mockConnections) });
  }],

  // Charts — return per-chart mock data based on URL path
  ['api/v1/charts/', (route) => {
    const url = route.request().url();
    const chartMap: Record<string, object> = {
      'training_load': mockData.mockTrainingLoadChart,
      'power_curve': mockData.mockPowerCurveChart,
      'power_zones': mockData.mockPowerZonesChart,
      'daily_tss': mockData.mockDailyTssChart,
      'ftp_history': mockData.mockFtpHistoryChart,
      'hr_zones': mockData.mockHrZoneChart,
      'vo2max_trend': mockData.mockVo2maxTrendChart,
      'decoupling_trend': mockData.mockDecouplingTrendChart,
      'weight_trend': mockData.mockWeightTrendChart,
      'periodization': mockData.mockPeriodizationChart,
      'weekly_tss': mockData.mockWeeklyTssChart,
      'strain_vs_recovery': mockData.mockStrainVsRecoveryChart,
    };
    const chartType = Object.keys(chartMap).find(key => url.includes(key));
    const data = chartType ? chartMap[chartType] : mockData.mockChartData;
    route.fulfill({ status: 200, body: JSON.stringify(data) });
  }],

  // Weight
  ['api/v1/metrics/weight', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify(mockData.mockWeightHistory) });
  }],

  // Export endpoints
  ['api/v1/export/', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'text/csv',
      body: 'id,name,date\n1,test,2026-01-01',
    });
  }],

  // Mutation endpoints (POST)
  ['api/v1/cycling/recalculate-tss', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify({ status: 'ok', updated: 5 }) });
  }],
  ['api/v1/cycling/backfill-streams', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify({ status: 'ok', processed: 3 }) });
  }],
  ['api/v1/cycling/backfill-ftp-history', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify({ status: 'ok', entries_created: 2 }) });
  }],

  // Sync endpoints (POST)
  ['api/v1/routes/sync', (route) => {
    route.fulfill({ status: 200, body: JSON.stringify([{ provider: 'strava', synced_count: 5, merged_count: 1, new_count: 4 }]) });
  }],
];

// ─── Fixture definition ─────────────────────────────────────────────────────

type TestFixtures = {
  authenticatedPage: Page;
};

export const test = base.extend<TestFixtures>({
  authenticatedPage: async ({ page }, use) => {
    // Register all default API mocks
    // IMPORTANT: Only intercept /api/** requests — NOT a catch-all '**/*'.
    // A catch-all intercepts Next.js RSC (React Server Components) requests,
    // breaking page rendering (pages appear blank with only the sidebar visible).
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();

      // Find matching handler
      for (const [pattern, handler] of defaultApiHandlers) {
        if (url.includes(pattern)) {
          handler(route);
          return;
        }
      }

      // For unmatched API requests, continue normally
      await route.continue();
    });

    await use(page);
  },
});

export { expect } from '@playwright/test';
