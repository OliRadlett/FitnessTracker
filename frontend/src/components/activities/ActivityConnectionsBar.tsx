'use client';

import React from 'react';
import Link from 'next/link';
import type { ActivityConnections, ActivityPrLink, ActivityPlanDayLink, ActivityAiAnalysisLink, ActivityFuelPlanLink } from '@/lib/api';

interface ActivityConnectionsBarProps {
  connections: ActivityConnections;
  activityId?: string;
}

function PrBadge({ pr }: { pr: ActivityPrLink }) {
  return (
    <Link
      href={`/lifting?pr=${pr.id}`}
      className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-positive/20 text-positive border border-positive/30 hover:bg-positive/30 transition-colors"
      title={`PR: ${pr.exercise_name} ${pr.weight_kg}kg × ${pr.reps} reps (~${pr.estimated_1rm}kg e1rm)`}
      onClick={(e) => e.stopPropagation()}
    >
      <span aria-hidden>⭐</span> {pr.exercise_name}
    </Link>
  );
}

function PlanBadge({ plan }: { plan: ActivityPlanDayLink }) {
  return (
    <Link
      href={`/training?plan=${plan.plan_id}`}
      className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-accent/20 text-accent border border-accent/30 hover:bg-accent/30 transition-colors"
      title={`${plan.plan_name} · Day ${plan.day_number} · ${plan.planned_type}`}
      onClick={(e) => e.stopPropagation()}
    >
      <span aria-hidden>📋</span> {plan.day_number}
    </Link>
  );
}

function AiAnalysisBadge({ analysis, activityId }: { analysis: ActivityAiAnalysisLink; activityId?: string }) {
  return (
    <Link
      href={activityId ? `/activities?activity=${activityId}` : '#'}
      className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-500/20 text-purple-400 border border-purple-500/30 hover:bg-purple-500/30 transition-colors"
      title={analysis.summary ?? 'AI analysis available'}
      onClick={(e) => e.stopPropagation()}
    >
      <span aria-hidden>🤖</span> AI
    </Link>
  );
}

function FuelPlanBadge({ plan }: { plan: ActivityFuelPlanLink }) {
  const detail = plan.during_carbs_per_hour_g
    ? `${plan.during_carbs_per_hour_g.toFixed(0)}g/hr`
    : plan.pre_ride_carbs_g
      ? `${plan.pre_ride_carbs_g.toFixed(0)}g pre`
      : '';
  return (
    <span
      className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-500/20 text-orange-400 border border-orange-500/30"
      title={`Fuel plan: ${detail}`}
    >
      <span aria-hidden>🍌</span> {detail || 'Planned'}
    </span>
  );
}

export function ActivityConnectionsBar({ connections, activityId }: ActivityConnectionsBarProps) {
  const items: React.ReactNode[] = [];

  if (connections.training_plan_day) {
    items.push(<PlanBadge key="plan" plan={connections.training_plan_day} />);
  }

  if (connections.personal_records && connections.personal_records.length > 0) {
    connections.personal_records.slice(0, 3).forEach((pr) => {
      items.push(<PrBadge key={`pr-${pr.id}`} pr={pr} />);
    });
  }

  if (connections.ai_analysis) {
    items.push(<AiAnalysisBadge key="ai" analysis={connections.ai_analysis} activityId={activityId} />);
  }

  if (connections.fuel_plan) {
    items.push(<FuelPlanBadge key="fuel" plan={connections.fuel_plan} />);
  }

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-1.5 mb-2">
      {items}
    </div>
  );
}
