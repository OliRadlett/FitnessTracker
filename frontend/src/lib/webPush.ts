'use client';

// §3.8 Web Push — subscribe/unsubscribe a device via the browser PushManager
// and mirror it to the backend (/push/subscriptions). The VAPID public key is
// served by the backend so the real keypair never ships to the client.

type AuthFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

export type PushCapability = 'unsupported' | 'denied' | 'available' | 'granted';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const bare = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(bare);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function arrayBufferToBase64(buffer: ArrayBuffer | null): string {
  if (!buffer) return '';
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Does this browser + site support push at all? */
export async function getPushCapability(): Promise<PushCapability> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return 'unsupported';
  }
  if (!('pushManager' in ServiceWorkerRegistration.prototype)) {
    return 'unsupported';
  }
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.permission === 'granted' ? 'granted' : 'available';
}

/** Register this device for Web Push. Returns {ok} and a friendly error when not. */
export async function subscribeToWebPush(
  authFetch: AuthFetch,
): Promise<{ ok: boolean; error?: string }> {
  try {
    let reg = await navigator.serviceWorker.getRegistration();
    if (!reg) {
      await navigator.serviceWorker.register('/fittrack/sw.js');
      reg = await navigator.serviceWorker.ready;
    }
    if (!reg || !reg.pushManager) {
      return { ok: false, error: 'This browser does not support web push.' };
    }

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      // The VAPID public key comes from the backend (404 when unconfigured).
      let publicKey: string;
      try {
        const res = await authFetch<{ public_key: string }>('/api/v1/push/vapid-public-key');
        publicKey = res.public_key;
      } catch {
        return { ok: false, error: 'Web push is not configured on the server yet.' };
      }
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey).buffer as ArrayBuffer,
      });
    }
    if (!sub) return { ok: false, error: 'Could not create a push subscription.' };

    await authFetch('/api/v1/push/subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        endpoint: sub.endpoint,
        p256dh: arrayBufferToBase64(sub.getKey('p256dh')),
        auth: arrayBufferToBase64(sub.getKey('auth')),
      }),
    });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('permission')) {
      return { ok: false, error: 'Notification permission was denied.' };
    }
    return { ok: false, error: `Push setup failed: ${msg}` };
  }
}

/** Disable Web Push for this device (unsubscribes + unregisters). */
export async function unsubscribeFromWebPush(
  authFetch: AuthFetch,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub && !sub.unsubscribe) return { ok: false, error: 'Push is already inactive.' };
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      try {
        await authFetch('/api/v1/push/subscriptions', {
          method: 'DELETE',
          body: JSON.stringify({ endpoint }),
        });
      } catch {
        // Backend might be down — local unsubscribe still matters.
      }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Number of devices registered for this user on the backend. */
export async function getPushCount(authFetch: AuthFetch): Promise<number> {
  try {
    const res = await authFetch<{ count: number }>('/api/v1/push/subscriptions');
    return res.count ?? 0;
  } catch {
    return 0;
  }
}