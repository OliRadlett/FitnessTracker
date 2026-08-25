import React from 'react';

export const PROVIDER_COLORS: Record<string, string> = {
  strava: 'bg-orange-500',
  komoot: 'bg-green-600',
  wahoo: 'bg-blue-500',
  manual: 'bg-gray-500',
};

const PROVIDER_ICONS: Record<string, string> = {
  strava: '/icons/strava.svg',
  komoot: '/icons/komoot.svg',
  wahoo: '/icons/wahoo.svg',
  manual: '',
};

export function ProviderIcon({ provider, size = 14 }: { provider: string; size?: number }) {
  const src = PROVIDER_ICONS[provider];
  if (src) {
    return <img src={src} alt={`${provider} logo`} className="inline-block" style={{ width: size, height: size }} />;
  }
  return <span aria-hidden="true">✏️</span>;
}

export function ProviderBadge({ provider }: { provider: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-white ${PROVIDER_COLORS[provider] || 'bg-gray-500'}`}>
      <ProviderIcon provider={provider} size={12} />
      {provider}
    </span>
  );
}
