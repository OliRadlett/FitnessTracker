'use client';

// Unit & locale preferences — server-stored (User.preferences JSONB), served
// from __/user/preferences. The provider syncs a module singleton in lib/utils
// so every formatDistance/formatDateDMY/formatTime call honors the preference
// without threading a hook through each call site.

import React, { createContext, useCallback, useContext, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuthFetch } from '@/lib/api/fetch';
import type { UserPreferences } from '@/lib/api/types/preferences';
import { setActivePreferences } from '@/lib/utils';

interface UnitsContextValue {
  preferences: UserPreferences | undefined;
  isImperial: boolean;
  setPreference: (patch: Partial<UserPreferences>) => void;
}

const UnitsContext = createContext<UnitsContextValue | null>(null);

export function UnitsProvider({ children }: { children: React.ReactNode }) {
  const { authFetch, token } = useAuthFetch();
  const queryClient = useQueryClient();

  const { data: preferences } = useQuery<UserPreferences>({
    queryKey: ['preferences'],
    queryFn: () => authFetch<UserPreferences>('/api/v1/user/preferences'),
    staleTime: 5 * 60_000,
    enabled: !!token,
  });

  if (preferences) {
    setActivePreferences(preferences);
  }

  const mutation = useMutation({
    mutationFn: (patch: Partial<UserPreferences>) =>
      authFetch<UserPreferences>('/api/v1/user/preferences', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onMutate: (patch) => {
      const prev = queryClient.getQueryData<UserPreferences>(['preferences']);
      queryClient.setQueriesData<UserPreferences>({ queryKey: ['preferences'] }, (old) => ({
        ...(old ?? { unit_system: 'metric', locale: 'en-GB', time_format: '24h' }),
        ...patch,
      }));
      return { prev };
    },
    onError: (_err, _patch, ctx) => {
      queryClient.setQueriesData<UserPreferences>({ queryKey: ['preferences'] }, ctx?.prev);
    },
  });

  const setPreference = useCallback(
    (patch: Partial<UserPreferences>) => mutation.mutate(patch),
    [mutation],
  );

  const value = useMemo<UnitsContextValue>(
    () => ({
      preferences,
      isImperial: preferences?.unit_system === 'imperial',
      setPreference,
    }),
    [preferences, setPreference],
  );

  return <UnitsContext.Provider value={value}>{children}</UnitsContext.Provider>;
}

export function useUnits(): UnitsContextValue {
  const ctx = useContext(UnitsContext);
  if (!ctx) {
    throw new Error('useUnits must be used within a UnitsProvider');
  }
  return ctx;
}