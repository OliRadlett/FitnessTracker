'use client';

/**
 * Cycling profile — FTP, weight, threshold HR and the FTP-estimate flow.
 *
 * Moved out of `/cycling` with the page rewrite: it is a settings surface, and
 * the training page should not be the only place a threshold can be edited (FTP
 * drives zones, TSS, W/kg and every chart). The form itself is the same
 * component, unchanged; this wrapper owns the queries and mutations.
 */
import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import { updateCyclingProfile } from '@/lib/api';
import type { CyclingProfile, CyclingProfileUpdate, FtpEstimate } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { ProfileEditor } from './ProfileEditor';

export function CyclingProfileCard() {
  const { authFetch, token } = useAuthFetch();
  const queryClient = useQueryClient();
  const [estimate, setEstimate] = React.useState<FtpEstimate | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const timers = React.useRef<NodeJS.Timeout[]>([]);

  React.useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const flash = (text: string, ms = 3000) => {
    setMessage(text);
    timers.current.push(setTimeout(() => setMessage(null), ms));
  };

  const profile = useQuery<CyclingProfile>({
    queryKey: ['cycling-profile'],
    queryFn: () => authFetch<CyclingProfile>('/api/v1/cycling/profile'),
    staleTime: 300_000,
    enabled: !!token,
  });

  const invalidate = () => {
    for (const key of [
      ['cycling-profile'],
      ['cycling-metrics'],
      ['power-zones'],
      ['chart-power-zones'],
      ['ftp-history'],
      ['chart-ftp-history'],
      ['training-load'],
      ['lifetime-pbs'],
    ]) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };

  const save = useMutation({
    mutationFn: (data: CyclingProfileUpdate) => updateCyclingProfile(authFetch, data),
    onSuccess: () => {
      invalidate();
      flash('Profile saved.');
    },
    onError: () => flash("Couldn't save — check your connection and try again.", 5000),
  });

  const estimateFtp = useMutation({
    mutationFn: () => authFetch<FtpEstimate>('/api/v1/cycling/estimate-ftp?days=90', { method: 'POST' }),
    onSuccess: (data) => setEstimate(data),
    onError: () => {
      setEstimate(null);
      flash("Couldn't estimate FTP — try again.", 5000);
    },
  });

  const acceptEstimate = useMutation({
    mutationFn: () => authFetch<FtpEstimate>('/api/v1/cycling/estimate-ftp?days=90&accept=true', { method: 'POST' }),
    onSuccess: (data) => {
      setEstimate(data);
      invalidate();
      flash('FTP estimated and saved.');
    },
    onError: () => flash("Couldn't save the estimate — try again.", 5000),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cycling profile</CardTitle>
      </CardHeader>
      <div className="px-6 pb-6">
        <p className="mb-4 text-sm text-muted">
          Thresholds the cycling analysis is built on. FTP drives zones, TSS and W/kg, so a stale number here changes
          every chart on the page.
        </p>
        <ProfileEditor
          profile={profile.data}
          onSave={(data) => save.mutate(data)}
          isSaving={save.isPending}
          onEstimateFtp={() => estimateFtp.mutate()}
          ftpEstimate={estimate}
          isEstimating={estimateFtp.isPending}
          onAcceptEstimate={() => acceptEstimate.mutate()}
          saveMessage={message}
        />
      </div>
    </Card>
  );
}
