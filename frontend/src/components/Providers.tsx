'use client';

import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { SessionProvider } from 'next-auth/react';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 120_000,  // 2 min — avoids re-fetching on every tab switch
      gcTime: 5 * 60_000,  // 5 min garbage collection
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * When the backend JWT changes (initial load, silent refresh healing an expired
 * token, re-login), queries that previously 401'd hold error/empty data and
 * won't refetch for up to staleTime. Invalidate on token change so the UI
 * recovers the moment the new token is ready instead of staying stuck.
 */
function BackendTokenWatcher() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const token = session?.backendToken;

  const firstToken = React.useRef<string | null>(null);
  const firstTokenSeen = React.useRef(false);

  useEffect(() => {
    if (!token) return;
    // Skip the initial settlement — first token establishes the baseline.
    if (!firstTokenSeen.current) {
      firstTokenSeen.current = true;
      firstToken.current = token;
      return;
    }
    if (firstToken.current !== token) {
      firstToken.current = token;
      void queryClient.invalidateQueries();
    }
  }, [token, queryClient]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider basePath="/fittrack/api/auth">
      <QueryClientProvider client={queryClient}>
        <BackendTokenWatcher />
        {children}
      </QueryClientProvider>
    </SessionProvider>
  );
}
