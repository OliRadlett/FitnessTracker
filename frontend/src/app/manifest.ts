import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'FitTrack',
    short_name: 'FitTrack',
    description: 'Personal fitness tracker for powerlifting and cycling',
    start_url: '/fittrack',
    scope: '/fittrack',
    display: 'standalone',
    background_color: '#0f172a',
    theme_color: '#0f172a',
    icons: [
      {
        src: '/fittrack/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/fittrack/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
      {
        src: '/fittrack/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
