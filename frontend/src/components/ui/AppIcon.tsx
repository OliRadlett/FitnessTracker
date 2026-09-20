'use client';

import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface AppIconProps {
  icon: LucideIcon;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

/**
 * Lucide icon wrapper — consistent sizing and `aria-hidden` by default.
 * Pass `label` via the parent control's `aria-label` instead.
 */
export function AppIcon({ icon: Icon, size = 18, strokeWidth = 2, className = '' }: AppIconProps) {
  return <Icon size={size} strokeWidth={strokeWidth} className={className} aria-hidden="true" />;
}
