import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
// Leaflet styles vendored from the installed package (was unpkg CDN — a
// third-party request on EVERY page that stalled networkidle in CI and
// broke map styling offline).
import 'leaflet/dist/leaflet.css';
import { Providers } from '@/components/Providers';
import { PwaRegister } from '@/components/PwaRegister';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

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
    <html lang="en" className={`dark ${inter.variable}`}>
      <head>
        <link rel="apple-touch-icon" href="/fittrack/icons/icon-192.png" />
      </head>
      <body className="bg-background text-foreground font-sans antialiased">
        <Providers>
          {children}
        </Providers>
        <PwaRegister />
      </body>
    </html>
  );
}
