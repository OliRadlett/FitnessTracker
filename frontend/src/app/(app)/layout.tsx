'use client';

import React from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { Sidebar, SidebarProvider, MobileMenuButton } from '@/components/Sidebar';
import { NotificationBell } from '@/components/ui/NotificationBell';
import { PageLoadingBar } from '@/components/ui/PageLoadingBar';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { SyncHealthBanner } from '@/components/sync/SyncHealthBanner';
import { CommandPalette } from '@/components/ui/CommandPalette';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { OfflineSnapshot } from '@/components/ui/OfflineSnapshot';
import { UnitsProvider } from '@/lib/units';

const SESSION_COOKIE = 'next-auth.session-token';

/** True if the NextAuth session cookie is present and not yet at/expired-time. */
function hasLiveSessionCookie(): boolean {
  if (typeof document === 'undefined') return false;
  const cookie = document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!cookie) return false;
  const raw = decodeURIComponent(cookie.split('=').slice(1).join('='));
  // The default NextAuth JWT payload carries `exp` — if present and in the
  // past the cookie is useless and the user genuinely needs to sign in.
  try {
    const payload = JSON.parse(raw);
    if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) return false;
  } catch {
    // Not a JWT — presence is all we have.
  }
  return true;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const router = useRouter();
  const bouncedRef = useRef(false);

  // Only bounce to the sign-in page when the NextAuth cookie is genuinely
  // gone/expired. On PWA wake / tab focus, next-auth re-fetches the session; a
  // momentary network blip can report `unauthenticated` even though the cookie
  // is still valid, which used to kick the user out to the login page and force
  // a re-login. Give a short grace window for the refetch to settle, and never
  // bounce while the cookie is present — the session recovers on the retry.
  const genuinelySignedOut = status === 'unauthenticated' && !hasLiveSessionCookie();

  useEffect(() => {
    if (!genuinelySignedOut) return;
    const timer = setTimeout(() => {
      if (bouncedRef.current) return;
      bouncedRef.current = true;
      router.push('/');
    }, 1500);
    return () => clearTimeout(timer);
  }, [genuinelySignedOut, router]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-accent"></div>
      </div>
    );
  }

  // Truly signed out (no cookie) — waiting out the grace window before bounce.
  if (genuinelySignedOut) {
    return null;
  }

  // Everything else (authenticated, or a transient unauthenticated report with
  // a still-valid cookie) keeps the app shell up. For the transient case the
  // session resolves on the next refetch; children gate on `session`.
  return <AppShell>{children}</AppShell>;
}

function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
<UnitsProvider>
        <OfflineSnapshot>
          <div className="flex min-h-screen bg-background">
            <PageLoadingBar />
            <MobileMenuButton />
            <NotificationBell />
            <CommandPalette />
            <Sidebar />
            <main role="main" className="flex-1 overflow-auto">
              <div className="p-4 pt-16 md:p-8">
                <SyncHealthBanner />
                <OfflineBanner />
                <ErrorBoundary>
                  {children}
                </ErrorBoundary>
              </div>
            </main>
          </div>
        </OfflineSnapshot>
      </UnitsProvider>
    </SidebarProvider>
  );
}