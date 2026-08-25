import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/components/Providers';
import { PwaRegister } from '@/components/PwaRegister';

export const metadata: Metadata = {
  title: 'FitTrack',
  description: 'Track your fitness activities, lifting sessions, and performance metrics',
  manifest: '/fittrack/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'FitTrack',
  },
};

export const viewport: Viewport = {
  themeColor: '#0f172a',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <link rel="apple-touch-icon" href="/fittrack/icons/icon-192.png" />
      </head>
      <body className="bg-background text-slate-200 antialiased">
        <Providers>
          {children}
        </Providers>
        <PwaRegister />
      </body>
    </html>
  );
}
