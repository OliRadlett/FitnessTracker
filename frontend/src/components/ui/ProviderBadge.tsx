import React from 'react';

export const PROVIDER_COLORS: Record<string, string> = {
  strava: 'bg-orange-500',
  komoot: 'bg-green-600',
  wahoo: 'bg-blue-500',
  whoop: 'bg-purple-500',
  withings: 'bg-teal-500',
  manual: 'bg-muted',
};

const PROVIDER_ICONS: Record<string, string> = {
  strava: '/icons/strava.svg',
  komoot: '/icons/komoot.svg',
  wahoo: '/icons/wahoo.svg',
  whoop: '/icons/whoop.svg',
  withings: '/icons/withings.svg',
  manual: '',
};

export function ProviderIcon({ provider, size = 14 }: { provider: string; size?: number }) {
  const src = PROVIDER_ICONS[provider];
  if (src) {
    return <img src={src} alt={`${provider} logo`} className="inline-block" style={{ width: size, height: size }} />;
  }
  return <span aria-hidden="true">✏️</span>;
}
