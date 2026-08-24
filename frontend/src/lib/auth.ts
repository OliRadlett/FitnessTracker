import type { NextAuthOptions } from 'next-auth';
import type { DefaultSession, Session } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import GoogleProvider from 'next-auth/providers/google';
import GitHubProvider from 'next-auth/providers/github';

const API_BASE_URL = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// Comma-separated email allowlist. Empty = allow all.
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

declare module 'next-auth' {
  interface Session {
    backendToken?: string;
    user: {
      id: string;
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    backendToken?: string;
  }
}

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
      if (account && token.email) {
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
              provider: account.provider,
              provider_user_id: account.providerAccountId,
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
  secret: process.env.NEXTAUTH_SECRET || process.env.SECRET_KEY,
};
