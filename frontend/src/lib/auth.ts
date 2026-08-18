import type { NextAuthOptions } from 'next-auth';
import type { DefaultSession, Session } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import GoogleProvider from 'next-auth/providers/google';
import GitHubProvider from 'next-auth/providers/github';

const API_BASE_URL = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// Store backend token temporarily during sign-in flow
let pendingBackendToken: string | undefined;

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
    async signIn({ user, account }) {
      // After successful OAuth, sync user with backend and get a JWT
      if (user.email && account) {
        try {
          const res = await fetch(`${API_BASE_URL}/api/v1/auth/sync-user`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: user.email,
              name: user.name || '',
              avatar_url: user.image || null,
              provider: account.provider,
              provider_user_id: account.providerAccountId,
            }),
          });

          if (res.ok) {
            const data = await res.json();
            pendingBackendToken = data.access_token;
          }
        } catch (err) {
          console.error('Failed to sync user with backend:', err);
        }
      }
      return true;
    },
    async jwt({ token }: { token: JWT }) {
      if (pendingBackendToken) {
        token.backendToken = pendingBackendToken;
        pendingBackendToken = undefined;
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
