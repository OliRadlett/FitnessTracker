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

    setInstallDismissed(Boolean(localStorage.getItem(DISMISS_KEY)));

    navigator.serviceWorker.register('/fittrack/sw.js').catch(() => {
      // SW registration failed — non-critical, app works without it
    });

    // ── Install prompt flow (§3.7) ────────────────────────────────────────
    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      if (!isStandalone() && !localStorage.getItem(DISMISS_KEY)) {
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
    localStorage.setItem(DISMISS_KEY, '1');
  };

  if (!updateAvailable && !installPrompt) return null;

  return (
    <>
      {updateAvailable && (
        <div className="fixed top-0 left-0 right-0 z-[60] flex items-center justify-between gap-3 bg-accent text-background px-4 py-2.5 text-sm font-medium shadow-lg">
          <span>A new version of FitTrack is available.</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => window.location.reload()}
              className="px-3 py-1 rounded bg-background/90 text-accent text-xs font-semibold"
            >
              Reload
            </button>
            <button
              onClick={() => setUpdateAvailable(false)}
              aria-label="Dismiss"
              className="p-0.5 rounded hover:bg-background/20"
            >
              <span aria-hidden>✕</span>
            </button>
          </div>
        </div>
      )}
      {installPrompt && !installDismissed && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 rounded-xl bg-surface-light border border-accent/30 px-4 py-3 shadow-xl">
          <span className="text-xl" aria-hidden>🏋️</span>
          <div>
            <p className="text-sm font-medium text-white">Install FitTrack</p>
            <p className="text-xs text-muted">Add to your home screen for quick access.</p>
          </div>
          <button
            onClick={handleInstall}
            className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent/80 transition-colors whitespace-nowrap"
          >
            Install
          </button>
          <button
            onClick={handleInstallDismiss}
            aria-label="Dismiss install prompt"
            className="p-1 rounded hover:bg-background/20 text-muted"
          >
            <span aria-hidden>✕</span>
          </button>
        </div>
      )}
    </>
  );
}
