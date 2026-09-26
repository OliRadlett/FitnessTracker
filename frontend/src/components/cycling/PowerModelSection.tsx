'use client';

import React from 'react';
import type { PowerModelResultsResponse } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';

interface PowerModelSectionProps {
  powerModel: PowerModelResultsResponse | undefined;
  isLoading: boolean;
}

export function PowerModelSection({ powerModel, isLoading }: PowerModelSectionProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>⚡ Personalized Power Model</CardTitle>
        </CardHeader>
        <div className="text-sm text-muted">Loading power model...</div>
      </Card>
    );
  }

  if (!powerModel) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>⚡ Personalized Power Model</CardTitle>
        </CardHeader>
        <div className="text-sm text-muted">
          Power model not yet fitted. Models are fitted weekly on Sundays.
          Ensure Strava is connected and activities have power data.
        </div>
      </Card>
    );
  }

  const cp = powerModel.critical_power;
  const vo2max = powerModel.personalized_vo2max;
  const constants = powerModel.adaptive_constants;

  return (
    <Card>
      <CardHeader>
        <CardTitle>⚡ Personalized Power Model</CardTitle>
      </CardHeader>

      {/* Critical Power Stats */}
      {cp && cp.cp && (
        <div className="mb-4">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="bg-surface-light rounded-lg p-3">
              <div className="text-xs text-muted mb-1">Critical Power</div>
              <div className="text-lg font-mono font-bold text-accent">
                {cp.cp.toFixed(0)} <span className="text-xs text-muted">W</span>
              </div>
            </div>
            <div className="bg-surface-light rounded-lg p-3">
              <div className="text-xs text-muted mb-1">W&apos; (Anaerobic)</div>
              <div className="text-lg font-mono font-bold text-purple-400">
                {cp.w_prime ? (
                  <>
                    {(cp.w_prime / 1000).toFixed(1)}{' '}
                    <span className="text-xs text-muted">kJ</span>
                  </>
                ) : '—'}
              </div>
            </div>
            <div className="bg-surface-light rounded-lg p-3">
              <div className="text-xs text-muted mb-1">Pmax (Sprint)</div>
              <div className="text-lg font-mono font-bold text-cyan-400">
                {cp.p_max ? (
                  <>
                    {cp.p_max.toFixed(0)}{' '}
                    <span className="text-xs text-muted">W</span>
                  </>
                ) : '—'}
              </div>
            </div>
            <div className="bg-surface-light rounded-lg p-3">
              <div className="text-xs text-muted mb-1">Model Fit (R²)</div>
              <div className="text-lg font-mono font-bold text-positive">
                {cp.model_r_squared ? (cp.model_r_squared * 100).toFixed(1) : '—'}%
              </div>
            </div>
            <div className="bg-surface-light rounded-lg p-3">
              <div className="text-xs text-muted mb-1">Data Points</div>
              <div className="text-lg font-mono font-bold text-muted">
                {cp.data_points_used}
              </div>
            </div>
          </div>
          <div className="mt-2 text-xs text-muted">
            Morton 3-param model: P(t) = W&apos;/(t + k) + CP, k = W&apos;/(Pmax − CP)
          </div>
        </div>
      )}

      {/* Personalized VO2max */}
      {vo2max && vo2max.vo2max && (
        <div className="mb-4 p-3 bg-surface-light rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-muted">Personalized VO2max</div>
              <div className="text-lg font-mono font-bold text-yellow-400">
                {vo2max.vo2max.toFixed(1)}{' '}
                <span className="text-xs text-muted">ml/kg/min</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted">Method</div>
              <div className="text-xs text-muted">Power-HR Regression</div>
            </div>
          </div>
        </div>
      )}

      {/* Adaptive Constants */}
      {constants && (
        <div className="mb-2">
          <div className="text-xs text-muted mb-2">Adaptive Training Load Constants</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-surface-light rounded-lg p-3">
              <div className="text-xs text-muted">CTL Time Constant</div>
              <div className="text-lg font-mono font-bold text-blue-400">
                {constants.ctl_tau}{' '}
                <span className="text-xs text-muted">days</span>
              </div>
              <div className="text-xs text-muted">
                (default: 42)
              </div>
            </div>
            <div className="bg-surface-light rounded-lg p-3">
              <div className="text-xs text-muted">ATL Time Constant</div>
              <div className="text-lg font-mono font-bold text-red-400">
                {constants.atl_tau}{' '}
                <span className="text-xs text-muted">days</span>
              </div>
              <div className="text-xs text-muted">
                (default: 7)
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Fitted At */}
      <div className="mt-3 text-xs text-muted">
        Last fitted: {powerModel.fitted_at
          ? new Date(powerModel.fitted_at).toLocaleDateString()
          : 'Never'}
      </div>
    </Card>
  );
}
