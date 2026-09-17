'use client';

export function TrendArrow({ trend }: { trend?: 'up' | 'down' | 'stable' | null }) {
  if (!trend || trend === 'stable') return <span className="text-muted">→</span>;
  if (trend === 'up') return <span className="text-positive">↑</span>;
  return <span className="text-warning">↓</span>;
}
