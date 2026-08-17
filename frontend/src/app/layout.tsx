import type { Metadata } from 'next';
import './globals.css';
import 'leaflet/dist/leaflet.css';
import { Providers } from '@/components/Providers';

export const metadata: Metadata = {
  title: 'Fitness Tracker',
  description: 'Track your fitness activities, lifting sessions, and performance metrics',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-background text-slate-200 antialiased">
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
