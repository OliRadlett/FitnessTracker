import type { NextAuthOptions } from 'next-auth';
import type { DefaultSession, Session } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import GoogleProvider from 'next-auth/providers/google';
import GitHubProvider from 'next-auth/providers/github';

const API_BASE_URL = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// NEXTAUTH_SECRET must be explicitly set — falling back to SECRET_KEY means the
// NextAuth session cookie and the backend JWT share a signing key, so compromising
// one exposes the other.
if (!process.env.NEXTAUTH_SECRET) {
  console.warn(
    '[auth] NEXTAUTH_SECRET is not set. Generate one with: ' +
      'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))". ' +
      'NextAuth session cookies will fall back to SECRET_KEY, which is insecure.'
  );
}

// Comma-separated email allowlist. Empty = allow all.
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

declare module 'next-auth' {
  interface Session {
    backendToken?: string;
    /** True when the backend JWT is missing or already expired. Every API call
     *  will 401 until it is refreshed or the user re-signs in. */
    backendTokenExpired?: boolean;
    user: {
      id: string;
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    backendToken?: string;
    /** Remembered from sign-in so silent refreshes can re-sync without `account` */
    authProvider?: string;
    authProviderId?: string;
    backendSyncAttemptedAt?: number;
  }
}

/** Decode the `exp` claim from a backend JWT without verifying it. */
function backendTokenExpiry(token?: string): number | null {
  if (!token) return null;
  try {
    const payload = JSON.parse(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
    );
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

// Refresh the backend token when it is missing, undecodable, or expiring soon.
const REFRESH_MARGIN_S = 3 * 24 * 60 * 60; // refresh when <3 days remain
const SYNC_RETRY_BACKOFF_S = 60 * 60; // at most one sync attempt per hour

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    }),
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID ?? '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      // Check email allowlist before proceeding
      if (ALLOWED_EMAILS.length > 0 && user.email) {
        const emailLower = user.email.toLowerCase();
        if (!ALLOWED_EMAILS.includes(emailLower)) {
          console.warn(`Sign-in rejected: ${user.email} is not in the allowlist`);
          return false;
        }
      }
      return true;
    },
    async jwt({ token, account }: { token: JWT; account?: { provider: string; providerAccountId: string } | null }) {
      // On initial sign-in, sync user with backend and get a JWT.
      // The `account` param is only present on the first call after sign-in.
      const nowS = Math.floor(Date.now() / 1000);
      const lastAttempt = token.backendSyncAttemptedAt ?? 0;
      const exp = backendTokenExpiry(token.backendToken);

      if (account) {
        token.authProvider = account.provider;
        token.authProviderId = account.providerAccountId;
      }
      const provider = account?.provider ?? token.authProvider;
      const providerUserId = account?.providerAccountId ?? token.authProviderId;

      // The backend token outlives nothing — once it nears expiry every API
      // call 401s and the user is forced to re-login. Silently mint a fresh
      // one while the NextAuth session (30d) is still alive. Backoff keeps a
      // failing backend from being hammered on every session check.
      const needsRefresh =
        !token.backendToken || exp === null || exp - nowS < REFRESH_MARGIN_S;
      // If the backend token is already expired (not just within the refresh
      // margin) every API call 401s. A dead token must be refreshed promptly on
      // wake, not suppressed by the 1-hour backoff that is meant for a
      // *healthy* token nearing expiry or a failing backend.  Use a short
      // backoff so a recovered backend is picked up quickly instead of forcing
      // the user to re-login.
      const tokenAlreadyExpired =
        !token.backendToken || exp === null || exp - nowS <= 0;
      const backoffS = tokenAlreadyExpired
        ? Math.min(SYNC_RETRY_BACKOFF_S, 60)
        : SYNC_RETRY_BACKOFF_S;
      const canSync = Boolean(token.email && provider && providerUserId);

      const shouldSync =
        (account && canSync) ||
        (needsRefresh && canSync && nowS - lastAttempt > backoffS);

      if (shouldSync) {
        if (!account) token.backendSyncAttemptedAt = nowS;
        try {
          const res = await fetch(`${API_BASE_URL}/api/v1/auth/sync-user`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              // Backend requires this to issue JWTs (BUG-003 protection)
              ...(process.env.INTERNAL_API_SECRET
                ? { 'X-Internal-Secret': process.env.INTERNAL_API_SECRET }
                : {}),
            },
            body: JSON.stringify({
              email: token.email,
              name: token.name || '',
              avatar_url: token.picture || null,
              provider,
              provider_user_id: providerUserId,
            }),
          });

          if (res.ok) {
            const data = await res.json();
            token.backendToken = data.access_token;
          }
        } catch (err) {
          console.error('Failed to sync user with backend:', err);
        }
      }
      return token;
    },
    async session({ session, token }: { session: Session; token: JWT }) {
      if (session.user) {
        session.user.id = token.sub ?? '';
        session.backendToken = token.backendToken;
        const exp = backendTokenExpiry(token.backendToken);
        session.backendTokenExpired =
          !token.backendToken || exp === null || exp * 1000 <= Date.now();
      }
      return session;
    },
  },
  pages: {
    signIn: '/',
    error: '/',
  },
  session: {
    strategy: 'jwt',
  },
  secret: process.env.NEXTAUTH_SECRET,
};
