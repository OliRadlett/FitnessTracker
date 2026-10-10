'use client';

import { useEffect, useState } from 'react';

// Chrome's desktop/mobile `beforeinstallprompt` fires before showing the
// browser's native install UI. We capture it so the user can trigger install
// from an in-app button instead of relying on the browser chrome.
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DISMISS_KEY = 'fittrack-install-dismissed';
// Re-prompt a month after dismissal — a forever-dismiss means users who
// dismissed early never learn the app is installable.
const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function isDismissedFresh(): boolean {
  try {
    const raw = globalThis.localStorage?.getItem(DISMISS_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    // Back-compat: the old flag stored '1' (no timestamp) — treat as fresh.
    if (!Number.isFinite(ts)) return true;
    return Date.now() - ts < DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

function isStandalone(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches;
}

export function PwaRegister() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installDismissed, setInstallDismissed] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    setInstallDismissed(isDismissedFresh());

    navigator.serviceWorker.register('/fittrack/sw.js').catch(() => {
      // SW registration failed — non-critical, app works without it
    });

    // ── Install prompt flow (§3.7) ────────────────────────────────────────
    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      if (!isStandalone() && !isDismissedFresh()) {
        setInstallPrompt(e as BeforeInstallPromptEvent);
      }
    };
    const onAppInstalled = () => {
      setInstallPrompt(null);
      localStorage.removeItem(DISMISS_KEY);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);

    // A freshly-activated SW (e.g. after a deploy) takes control of this tab
    // via clients.claim(), while the page is still running the *previous* JS
    // bundle. That bundle/SW mismatch is what makes newly-deployed routes
    // (such as /lifting/live) fail to load — the stale SW serves old chunks or
    // cached API responses. Prompt the user to reload so the running bundle
    // matches the active SW.
    //
    // `controllerchange` fires when the new SW claims an open tab (the v2 SW
    // calls skipWaiting() + clients.claim() on install, so this is reliable for
    // full navigations). `updatefound`/`waiting` cover in-page installs that
    // go through the "waiting" phase instead.
    const onControllerChange = () => setUpdateAvailable(true);
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    const checkWaiting = () => {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (reg && reg.waiting) setUpdateAvailable(true);
      });
    };
    checkWaiting();
    const onUpdateFound = () => {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (!reg) return;
        const installing = reg.installing;
        if (installing) {
          installing.addEventListener('statechange', () => checkWaiting());
        }
      });
    };
    navigator.serviceWorker.getRegistration().then((reg) => {
      reg?.addEventListener('updatefound', onUpdateFound);
    });

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      navigator.serviceWorker.getRegistration().then((reg) => {
        reg?.removeEventListener('updatefound', onUpdateFound);
      });
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallPrompt(null);
    if (choice.outcome === 'accepted') {
      localStorage.removeItem(DISMISS_KEY);
    }
  };

  const handleInstallDismiss = () => {
    setInstallPrompt(null);
    setInstallDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // Private-mode storage — dismiss for this session only
    }
  };

  if (!updateAvailable && !installPrompt) return null;

  // Phase 0 hygiene: both notices render as dismissible floating pills in a
  // single bottom-anchored stack — above the mobile tab bar + home-indicator
  // safe area, never over page headers (the old update banner was a top-0
  // full-width bar covering headers app-wide).
  return (
    <div className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] md:bottom-6 left-1/2 -translate-x-1/2 z-[60] flex flex-col items-center gap-2 w-max max-w-[calc(100vw-2rem)]">
      {updateAvailable && (
        <div
          role="status"
          className="flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full bg-surface-light border border-accent/30 pl-4 pr-1.5 py-1.5 shadow-xl"
        >
          <span className="text-sm font-medium text-foreground whitespace-nowrap">
            New FitTrack version available
          </span>
          <button
            onClick={() => window.location.reload()}
            className="px-3 py-1 min-h-[44px] rounded-full bg-accent text-white text-xs font-semibold hover:bg-accent-hover transition-colors whitespace-nowrap"
          >
            Reload
          </button>
          <button
            onClick={() => setUpdateAvailable(false)}
            aria-label="Dismiss update notice"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full hover:bg-background/20 text-muted"
          >
            <span aria-hidden>✕</span>
          </button>
        </div>
      )}
      {installPrompt && !installDismissed && (
        <div className="flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-xl bg-surface-light border border-accent/30 px-4 py-3 shadow-xl">
          <span className="text-xl" aria-hidden>🏋️</span>
          <div>
            <p className="text-sm font-medium text-foreground">Install FitTrack</p>
            <p className="text-xs text-muted">Add to your home screen for quick access.</p>
          </div>
          <button
            onClick={handleInstall}
            className="px-3 py-1.5 min-h-[44px] rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent/80 transition-colors whitespace-nowrap"
          >
            Install
          </button>
          <button
            onClick={handleInstallDismiss}
            aria-label="Dismiss install prompt"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded hover:bg-background/20 text-muted"
          >
            <span aria-hidden>✕</span>
          </button>
        </div>
      )}
    </div>
  );
}
