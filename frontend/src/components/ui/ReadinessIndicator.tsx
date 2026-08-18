'use client';

import React from 'react';
import { Card } from '@/components/ui/Card';

interface ReadinessIndicatorProps {
  recoveryScore?: number | null;
  readiness?: 'green' | 'yellow' | 'red' | 'unknown';
  hrvMs?: number | null;
  restingHr?: number | null;
  message?: string;
  compact?: boolean;
}

const readinessConfig = {
  green: {
    bg: 'bg-green-500/15',
    border: 'border-green-500/30',
    text: 'text-green-400',
    emoji: '🟢',
    label: 'Ready to Train',
  },
  yellow: {
    bg: 'bg-yellow-500/15',
    border: 'border-yellow-500/30',
    text: 'text-yellow-400',
    emoji: '🟡',
    label: 'Moderate',
  },
  red: {
    bg: 'bg-red-500/15',
    border: 'border-red-500/30',
    text: 'text-red-400',
    emoji: '🔴',
    label: 'Rest Day',
  },
  unknown: {
    bg: 'bg-slate-500/15',
    border: 'border-slate-500/30',
    text: 'text-slate-400',
    emoji: '⚪',
    label: 'No Data',
  },
};

export function ReadinessIndicator({
  recoveryScore,
  readiness = 'unknown',
  hrvMs,
  restingHr,
  message,
  compact = false,
}: ReadinessIndicatorProps) {
  const config = readinessConfig[readiness];

  if (compact) {
    return (
      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border ${config.bg} ${config.border}`}>
        <span className="text-sm">{config.emoji}</span>
        <span className={`text-sm font-medium ${config.text}`}>
          {config.label}
        </span>
        {recoveryScore != null && (
          <span className={`text-xs ${config.text} opacity-75`}>
            {recoveryScore.toFixed(0)}%
          </span>
        )}
      </div>
    );
  }

  return (
    <Card className={`${config.bg} border ${config.border}`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm text-muted">Training Readiness</p>
        <span className="text-lg">{config.emoji}</span>
      </div>
      <p className={`text-2xl font-bold ${config.text} mb-1`}>
        {recoveryScore != null ? `${recoveryScore.toFixed(0)}%` : '—'}
      </p>
      <p className={`text-sm font-medium ${config.text}`}>
        {config.label}
      </p>
      {message && (
        <p className="text-xs text-muted mt-1">{message}</p>
      )}
      {(hrvMs != null || restingHr != null) && (
        <div className="flex gap-4 mt-3 pt-2 border-t border-white/5">
          {hrvMs != null && (
            <div>
              <p className="text-xs text-muted">HRV</p>
              <p className="text-sm text-white">{hrvMs.toFixed(0)} ms</p>
            </div>
          )}
          {restingHr != null && (
            <div>
              <p className="text-xs text-muted">Resting HR</p>
              <p className="text-sm text-white">{restingHr.toFixed(0)} bpm</p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
