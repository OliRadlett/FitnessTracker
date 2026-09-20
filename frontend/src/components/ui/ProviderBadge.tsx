import React from 'react';
import { Pencil } from 'lucide-react';

export const PROVIDER_COLORS: Record<string, string> = {
  strava: 'bg-orange-500',
  komoot: 'bg-green-600',
  wahoo: 'bg-blue-500',
  whoop: 'bg-purple-500',
  withings: 'bg-teal-500',
  manual: 'bg-muted',
};

// next.config.js sets basePath '/fittrack' — raw <img> src is NOT prefixed
// automatically, so provider logos must carry the prefix explicitly.
const BASE_PATH = '/fittrack';

export const PROVIDER_ICONS: Record<string, string> = {
  strava: `${BASE_PATH}/icons/strava.svg`,
  komoot: `${BASE_PATH}/icons/komoot.svg`,
  wahoo: `${BASE_PATH}/icons/wahoo.svg`,
  whoop: `${BASE_PATH}/icons/whoop.svg`,
  withings: `${BASE_PATH}/icons/withings.svg`,
  manual: '',
};

export function ProviderIcon({ provider, size = 14 }: { provider: string; size?: number }) {
  const src = PROVIDER_ICONS[provider];
  if (src) {
    return <img src={src} alt={`${provider} logo`} className="inline-block" style={{ width: size, height: size }} />;
  }
  return <Pencil size={size} aria-hidden="true" className="inline-block text-muted" />;
}
