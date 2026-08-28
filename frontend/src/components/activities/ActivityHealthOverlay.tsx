'use client';

import type { HealthOverlay } from '@/lib/api';
import { getRecoveryColor } from '@/lib/sportUtils';

interface ActivityHealthOverlayProps {
  health: HealthOverlay;
}

export function ActivityHealthOverlay({ health }: ActivityHealthOverlayProps) {
  const items: React.ReactNode[] = [];

  if (health.hrv_ms !== undefined && health.hrv_ms !== null) {
    items.push(
      <span key="hrv" className="text-xs text-muted">
        HRV {health.hrv_ms.toFixed(0)}ms
      </span>
    );
  }

  if (health.recovery_score !== undefined && health.recovery_score !== null) {
    const colorClass = getRecoveryColor(health.recovery_score);
    items.push(
      <span key="recovery" className={`text-xs ${colorClass}`}>
        Recovery {Math.round(health.recovery_score)}%
      </span>
    );
  }

  if (health.resting_hr !== undefined && health.resting_hr !== null) {
    items.push(
      <span key="rhr" className="text-xs text-muted">
        RHR {Math.round(health.resting_hr)}bpm
      </span>
    );
  }

  if (health.sleep_duration_minutes !== undefined && health.sleep_duration_minutes !== null) {
    const hours = Math.round(health.sleep_duration_minutes / 60);
    const mins = Math.round(health.sleep_duration_minutes % 60);
    items.push(
      <span key="sleep" className="text-xs text-muted">
        Sleep {hours}h{mins}m
      </span>
    );
  }

  if (health.sleep_efficiency !== undefined && health.sleep_efficiency !== null) {
    items.push(
      <span key="efficiency" className="text-xs text-muted">
        Eff {Math.round(health.sleep_efficiency)}%
      </span>
    );
  }

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2 mt-1.5">
      <span aria-hidden>🌙</span>
      {items}
    </div>
  );
}
