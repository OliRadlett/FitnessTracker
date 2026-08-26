'use client';

import React from 'react';

type BadgeVariant = 'default' | 'cycling' | 'running' | 'swimming' | 'lifting' | 'positive' | 'warning' | 'muted';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-accent/20 text-accent border-accent/30',
  cycling: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  running: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  swimming: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  lifting: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  positive: 'bg-positive/20 text-positive border-positive/30',
  warning: 'bg-warning/20 text-warning border-warning/30',
  muted: 'bg-muted/20 text-muted border-muted/30',
};

export function getSportBadgeVariant(sportType: string): BadgeVariant {
  const normalized = sportType.toLowerCase();
  if (normalized.includes('cycl') || normalized.includes('bike')) return 'cycling';
  if (normalized.includes('run')) return 'running';
  if (normalized.includes('swim')) return 'swimming';
  if (normalized.includes('lift') || normalized.includes('strength') || normalized.includes('weight')) return 'lifting';
  return 'default';
}

export function Badge({ children, variant = 'default', className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${variantStyles[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
