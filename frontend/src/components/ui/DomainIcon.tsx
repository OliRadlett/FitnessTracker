'use client';

import React from 'react';
import { Activity } from 'lucide-react';
import { DOMAIN_ICONS } from '@/lib/domainIcons';

// Decorative domain icon for card headers — always aria-hidden, never the
// sole carrier of meaning.
export function DomainIcon({
  domain,
  className = 'w-5 h-5 text-accent shrink-0',
}: {
  domain: string;
  className?: string;
}) {
  const Icon = DOMAIN_ICONS[domain] ?? Activity;
  return <Icon className={className} aria-hidden />;
}
