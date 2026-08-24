'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ChartData, PowerCurveResponse, PowerZonesResponse, HrZonesResponse, PowerVsHrResponse } from '@/lib/api';
import { useAuthFetch } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Chart, ChartBody } from '@/components/charts/Chart';
import { PowerCurveTable } from '@/components/cycling/PowerCurveTable';
import { PowerZonesDisplay } from '@/components/cycling/PowerZonesDisplay';
import { HRZonesDisplay } from '@/components/cycling/HRZonesDisplay';

interface PowerCurveSectionProps {
  powerCurve: PowerCurveResponse | undefined;
  chartPowerCurve: ChartData | undefined;
  curveLoading: boolean;
  powerZones: PowerZonesResponse | undefined;
  chartPowerZones: ChartData | undefined;
  zonesLoading: boolean;
  chartPowerComparison: ChartData | undefined;
  comparisonDays: number;
  setComparisonDays: (days: number) => void;
  hrZones: HrZonesResponse | undefined;
  chartHrZones: ChartData | undefined;
  hasLthr: boolean;
  powerVsHr: PowerVsHrResponse | undefined;
  chartDailyTss: ChartData | undefined;
  chartWeightTrend: ChartData | undefined;
}

export function PowerCurveSection({
  powerCurve,
  chartPowerCurve,
  curveLoading,
  powerZones,
  chartPowerZones,
  zonesLoading,
  chartPowerComparison,
  comparisonDays,
  setComparisonDays,
  hrZones,
  chartHrZones,
  hasLthr,
  powerVsHr,
  chartDailyTss,
  chartWeightTrend,
}: PowerCurveSectionProps) {
  const { authFetch } = useAuthFetch();

  const { data: wkgChart, isLoading: wkgLoading } = useQuery<ChartData>({
    queryKey: ['chart-wkg-power-curve', 90],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/wkg_power_curve?days=90'),
    staleTime: 300_000,
  });

  const { data: percentileChart, isLoading: percentileLoading } = useQuery<ChartData>({
    queryKey: ['chart-power-duration-percentile', 90],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/power_duration_percentile?days=90'),
    staleTime: 300_000,
  });

  // Power vs HR chart data
  const powerVsHrChart: ChartData | null = powerVsHr?.data?.length
    ? {
        chart_type: 'scatter',
        title: 'Power vs Heart Rate',
        labels: powerVsHr.data.map((p) => String(p.power)),
        series: [
          {
            name: 'Rides',
            data: powerVsHr.data.map((p) => p.heart_rate),
          },
        ],
        x_label: 'Power (W)',
        y_label: 'Heart Rate (bpm)',
      }
    : null;

  return (
    <>
      {/* Power Curve + Power Zones */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Power Curve */}
        <Card>
          <CardHeader>
            <CardTitle>Power Curve (90 days)</CardTitle>
          </CardHeader>
          {curveLoading ? (
            <div className="h-60 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-accent"></div>
            </div>
          ) : powerCurve?.data?.some(p => p.best_power_watts != null) ? (
            <>
              {chartPowerCurve && <Chart data={chartPowerCurve} height={280} />}
              <div className="mt-4">
                <PowerCurveTable data={powerCurve.data} ftpWatts={powerCurve.ftp_watts} />
              </div>
            </>
          ) : (
            <div className="h-60 flex flex-col items-center justify-center text-muted text-sm">
              <p>No power data yet</p>
              <p className="text-xs mt-1">Fetch streams above to populate this chart</p>
            </div>
          )}
        </Card>

        {/* Power Zones */}
        <Card>
          <CardHeader>
            <CardTitle>Power Zones (30 days)</CardTitle>
          </CardHeader>
          {zonesLoading ? (
            <div className="h-60 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-accent"></div>
            </div>
          ) : powerZones?.zones?.length ? (
            <>
              <div className="mb-4">
                <p className="text-sm text-muted">
                  Based on FTP: <span className="text-yellow-400 font-mono">{powerZones.ftp_watts} W</span>
                </p>
              </div>
              <PowerZonesDisplay zones={powerZones.zones} />
              {chartPowerZones && <div className="mt-4"><Chart data={chartPowerZones} height={220} /></div>}
            </>
          ) : (
            <div className="h-60 flex items-center justify-center text-muted">
              Set your FTP and sync activities with power stream data to see zone distribution.
            </div>
          )}
        </Card>
      </div>

      {/* Power Curve Comparison */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between w-full">
            <CardTitle>⚡ Power Curve Comparison</CardTitle>
            <div className="flex gap-2">
              {[14, 30, 60, 90].map((d) => (
                <button
                  key={d}
                  onClick={() => setComparisonDays(d)}
                  className={`px-2 py-1 text-xs rounded border transition-colors ${
                    comparisonDays === d
                      ? 'bg-accent/20 text-accent border-accent/30'
                      : 'text-muted border-surface-light hover:border-accent/30'
                  }`}
                >
                  {d}d vs {d * 3}d
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <ChartBody
          data={chartPowerComparison}
          emptyMessage="No power data available for comparison. Fetch streams from Strava first."
          height={300}
        />
      </Card>

      {/* HR Zones + Weight Trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Heart Rate Zones */}
        <Card>
          <CardHeader>
            <CardTitle>Heart Rate Zones (30 days)</CardTitle>
          </CardHeader>
          {hrZones?.zones?.length ? (
            <>
              <HRZonesDisplay zones={hrZones.zones} lthr={hrZones.lthr} />
              {chartHrZones && <div className="mt-4"><Chart data={chartHrZones} height={220} /></div>}
            </>
          ) : (
            <div className="h-60 flex flex-col items-center justify-center gap-3">
              <p className="text-3xl">💓</p>
              {!hasLthr ? (
                <>
                  <p className="text-sm text-muted">Set your LTHR to see HR zone distribution</p>
                  <p className="text-xs text-muted">Enter your Lactate Threshold Heart Rate in the profile editor above</p>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted">No heart rate stream data available</p>
                  <p className="text-xs text-muted">Sync activities with HR data to populate zones</p>
                </>
              )}
            </div>
          )}
        </Card>

        {/* Weight Trend */}
        <Card>
          <CardHeader>
            <CardTitle>Body Weight Trend (90 days)</CardTitle>
          </CardHeader>
          <ChartBody
            data={chartWeightTrend}
            emptyMessage="No weight data available. Log weight in settings or sync from Whoop."
            height={280}
          />
        </Card>
      </div>

      {/* Daily TSS + Power vs HR */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Daily TSS (30 days)</CardTitle>
          </CardHeader>
          <ChartBody
            data={chartDailyTss}
            emptyMessage="No TSS data available"
            height={280}
          />
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Power vs Heart Rate (90 days)</CardTitle>
          </CardHeader>
          <ChartBody
            data={powerVsHrChart}
            emptyMessage="No power/HR data available"
            height={280}
          />
        </Card>
      </div>

      {/* W/kg Curve + Percentile Comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Power Curve — W/kg (90 days)</CardTitle>
          </CardHeader>
          <ChartBody
            isLoading={wkgLoading}
            data={wkgChart}
            emptyMessage="Fetch streams and log body weight to see your W/kg curve"
            height={280}
          />
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Power Profile vs Population Norms</CardTitle>
          </CardHeader>
          <ChartBody
            isLoading={percentileLoading}
            data={percentileChart}
            emptyMessage="Fetch streams and log body weight to compare against population norms"
            height={280}
          />
        </Card>
      </div>
    </>
  );
}
