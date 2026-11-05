'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { useAuthFetch } from '@/lib/api';
import type { User } from '@/lib/api';

const SEX_OPTIONS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

/**
 * Optional demographics. Used only to pick the age/sex-adjusted VO2max
 * reference scale; without them the app falls back to the labelled
 * cycling-fitness bands. Clearing both restores the fallback.
 */
export function AthleteProfileCard() {
  const { authFetch } = useAuthFetch();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [birthDate, setBirthDate] = useState('');
  const [sex, setSex] = useState('');
  const [saving, setSaving] = useState(false);

  const { data } = useQuery<User>({
    queryKey: ['me'],
    queryFn: () => authFetch<User>('/api/v1/auth/me'),
  });

  useEffect(() => {
    if (data) {
      setBirthDate(data.birth_date ?? '');
      setSex(data.sex ?? '');
    }
  }, [data]);

  const save = async () => {
    setSaving(true);
    try {
      await authFetch<User>('/api/v1/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({
          birth_date: birthDate || null,
          sex: sex || null,
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      toast.success('Athlete profile updated');
    } catch (error) {
      toast.error((error as Error)?.message || 'Could not save the athlete profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Athlete profile</CardTitle>
      </CardHeader>
      <div className="px-6 pb-6 space-y-4">
        <p className="text-sm text-muted">
          Optional. Used only for age/sex-adjusted VO2max reference bands. Leave blank to use the
          labelled cycling-fitness bands.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm text-muted">
            Date of birth
            <input
              type="date"
              value={birthDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(event) => setBirthDate(event.target.value)}
              className="rounded-lg border border-white/[0.08] bg-surface-light/30 px-3 py-2 text-sm text-foreground"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-muted">
            Sex
            <select
              value={sex}
              onChange={(event) => setSex(event.target.value)}
              className="rounded-lg border border-white/[0.08] bg-surface-light/30 px-3 py-2 text-sm text-foreground"
            >
              <option value="">Not set</option>
              {SEX_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-accent/20 px-3 py-2 text-sm font-medium text-accent disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </div>
    </Card>
  );
}
