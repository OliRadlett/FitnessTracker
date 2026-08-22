'use client';

import React from 'react';
import { Card } from '@/components/ui/Card';
import type { SuggestedCycleResponse, SuggestedDay } from '@/lib/api';

const readinessConfig = {
  green: {
    bg: 'bg-green-500/10',
    border: 'border-green-500/30',
    text: 'text-green-400',
    emoji: '🟢',
    label: 'Ready to Train',
  },
  yellow: {
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-500/30',
    text: 'text-yellow-400',
    emoji: '🟡',
    label: 'Moderate',
  },
  red: {
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    text: 'text-red-400',
    emoji: '🔴',
    label: 'Recovery Needed',
  },
};

const intensityColors = {
  none: 'bg-slate-500/15 text-slate-400 border-slate-500/20',
  low: 'bg-green-500/15 text-green-400 border-green-500/20',
  moderate: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20',
  high: 'bg-red-500/15 text-red-400 border-red-500/20',
};

function isToday(dateStr: string): boolean {
  const today = new Date();
  const d = new Date(dateStr);
  return (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  );
}

function DayCard({ day }: { day: SuggestedDay }) {
  const today = isToday(day.date);
  const colorClass = intensityColors[day.intensity] || intensityColors.moderate;

  return (
    <div
      className={`rounded-lg border p-3 transition-all ${
        today
          ? 'bg-accent/10 border-accent/40 ring-1 ring-accent/20'
          : 'bg-surface-light/30 border-surface-light/60 hover:bg-surface-light/50'
      }`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="text-lg">{day.icon}</span>
          <div>
            <span className={`text-sm font-semibold ${today ? 'text-accent' : 'text-white'}`}>
              {day.day_name}
            </span>
            {today && (
              <span className="ml-1.5 text-[10px] font-medium text-accent bg-accent/20 px-1.5 py-0.5 rounded">
                TODAY
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {day.target_tss != null && day.target_tss > 0 && (
            <span className="text-[10px] text-muted">{day.target_tss} TSS</span>
          )}
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${colorClass}`}>
            {day.intensity === 'none' ? 'Rest' : day.intensity}
          </span>
        </div>
      </div>
      <p className={`text-sm font-medium mb-0.5 ${today ? 'text-white' : 'text-white/90'}`}>
        {day.label}
      </p>
      <p className="text-xs text-muted leading-relaxed">{day.description}</p>
    </div>
  );
}

interface SuggestedCycleCardProps {
  data: SuggestedCycleResponse | undefined;
  isLoading: boolean;
}

export function SuggestedCycleCard({ data, isLoading }: SuggestedCycleCardProps) {
  if (isLoading) {
    return (
      <Card>
        <div className="animate-pulse space-y-4">
          <div className="h-5 bg-surface-light rounded w-48 mb-4"></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="h-28 bg-surface-light/40 rounded-lg"></div>
            ))}
          </div>
        </div>
      </Card>
    );
  }

  if (!data) return null;

  const config = readinessConfig[data.readiness] || readinessConfig.yellow;

  return (
    <Card className={`${config.bg} border ${config.border}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <span>📋</span> Suggested Training Cycle
          </h2>
          <p className="text-xs text-muted mt-0.5">Based on your recovery and training load</p>
        </div>
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${config.bg} ${config.border}`}>
          <span className="text-sm">{config.emoji}</span>
          <span className={`text-sm font-medium ${config.text}`}>{config.label}</span>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex flex-wrap gap-4 mb-4 text-xs">
        {data.latest_recovery != null && (
          <div className="flex items-center gap-1.5">
            <span className="text-muted">Recovery:</span>
            <span className={`font-semibold ${config.text}`}>{data.latest_recovery.toFixed(0)}%</span>
          </div>
        )}
        {data.latest_hrv != null && (
          <div className="flex items-center gap-1.5">
            <span className="text-muted">HRV:</span>
            <span className="text-blue-400 font-semibold">{data.latest_hrv.toFixed(0)}ms</span>
          </div>
        )}
        {data.current_tsb != null && (
          <div className="flex items-center gap-1.5">
            <span className="text-muted">TSB:</span>
            <span className={`font-semibold ${
              data.current_tsb > 10 ? 'text-green-400' : data.current_tsb < -10 ? 'text-orange-400' : 'text-blue-400'
            }`}>{data.current_tsb.toFixed(0)}</span>
          </div>
        )}
        {data.current_ctl != null && (
          <div className="flex items-center gap-1.5">
            <span className="text-muted">CTL:</span>
            <span className="text-blue-400 font-semibold">{data.current_ctl.toFixed(0)}</span>
          </div>
        )}
      </div>

      {/* Readiness message */}
      <p className="text-sm text-muted mb-4">{data.readiness_message}</p>

      {/* Day grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {data.days.map((day) => (
          <DayCard key={day.date} day={day} />
        ))}
      </div>

      {/* Summary */}
      <div className="bg-surface/40 rounded-lg p-3 border border-surface-light/30">
        <p className="text-xs text-muted leading-relaxed">
          <span className="font-semibold text-white/80">💡 Coach's Note: </span>
          {data.summary}
        </p>
      </div>
    </Card>
  );
}
