'use client';

// §3.10 First-run onboarding wizard.
//
// Four soft-prompt steps (never blocks): preferences → connections →
// fitness profile (FTP/weight/home) → optional first goal. Dismissible and
// re-openable from Settings ("Re-run onboarding"). First-run state lives in
// localStorage (`fittrack-onboarding-done`) so no server migration is needed;
// the wizard never blocks but is soft-suggested until dismissed.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, ModalHeader } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { useAuthFetch, Connection } from '@/lib/api';
import { getGoalMetrics, createGoal } from '@/lib/api/goals';
import type { MetricInfo } from '@/lib/api/types/training';
import { useUnits } from '@/lib/units';

const DONE_KEY = 'fittrack-onboarding-done';

const PROVIDERS: { id: string; name: string; emoji: string; description: string }[] = [
  { id: 'strava', name: 'Strava', emoji: '🚴', description: 'Cycling, running, power, HR, routes' },
  { id: 'whoop', name: 'Whoop', emoji: '💤', description: 'Recovery, sleep, HRV, strain' },
  { id: 'wahoo', name: 'Wahoo', emoji: '📊', description: 'Trainers & ELEMNT head units' },
  { id: 'komoot', name: 'Komoot', emoji: '🗺️', description: 'Planned routes & tours' },
];

type Step = 'prefs' | 'connections' | 'profile' | 'goal' | 'done';

export function OnboardingWizard() {
  const { data: session } = useSession();
  const { authFetch, token } = useAuthFetch();
  const units = useUnits();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('prefs');
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connLoaded, setConnLoaded] = useState(false);

  // Profile form state
  const [ftp, setFtp] = useState('');
  const [weight, setWeight] = useState('');
  const [homeLat, setHomeLat] = useState('');
  const [homeLng, setHomeLng] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);

  // Goal form state
  const [metrics, setMetrics] = useState<MetricInfo[]>([]);
  const [metricKey, setMetricKey] = useState('');
  const [target, setTarget] = useState('');
  const [creatingGoal, setCreatingGoal] = useState(false);
  const [goalMsg, setGoalMsg] = useState<string | null>(null);

  const done = useMemo(() => {
    try {
      return localStorage.getItem(DONE_KEY) === 'true';
    } catch {
      return false;
    }
  }, [open]);

  const markDone = useCallback(() => {
    try {
      localStorage.setItem(DONE_KEY, 'true');
    } catch {
      /* ignore */
    }
  }, []);

  const openWizard = useCallback(() => {
    setOpen(true);
    setStep('prefs');
  }, []);

  // Auto-open on first run (and when no data yet) once we have a token, and
  // honor an explicit "re-open from Settings" custom event.
  useEffect(() => {
    if (!token) return;
    const showOnFirstRun = !done;
    if (showOnFirstRun) {
      const timer = setTimeout(openWizard, 1200);
      return () => clearTimeout(timer);
    }
  }, [token, done, open, openWizard]);

  useEffect(() => {
    const onReopen = () => openWizard();
    window.addEventListener('fittrack:onboarding', onReopen);
    return () => window.removeEventListener('fittrack:onboarding', onReopen);
  }, [openWizard]);

  // Load connections for the connections step.
  useEffect(() => {
    if (!token || !open || step !== 'connections') return;
    authFetch<Connection[]>('/api/v1/connections/')
      .then(setConnections)
      .catch(() => setConnections([]))
      .finally(() => setConnLoaded(true));
  }, [token, open, step, authFetch]);

  // Load goal metrics for the goal step.
  useEffect(() => {
    if (!token || !open || step !== 'goal') return;
    const key = ['goal-metrics'] as const;
    const cached = queryClient.getQueryData<MetricInfo[]>(key);
    if (cached) {
      setMetrics(cached);
    } else {
      getGoalMetrics(authFetch).then((m) => {
        setMetrics(m);
        queryClient.setQueryData(key, m);
      });
    }
  }, [token, open, step, authFetch, queryClient]);

  const connectedCount = connections.filter((c) => c.status === 'active').length;

  const next = () => setStep((s) => (s === 'prefs' ? 'connections' : s === 'connections' ? 'profile' : s === 'profile' ? 'goal' : 'done'));

  const finish = () => {
    markDone();
    setOpen(false);
  };

  const skip = () => {
    markDone();
    setOpen(false);
  };

  const onSaveProfile = async () => {
    setSavingProfile(true);
    setProfileMsg(null);
    try {
      const patch: Record<string, unknown> = {};
      if (ftp !== '') patch.ftp_watts = parseFloat(ftp);
      if (weight !== '') patch.weight_kg = parseFloat(weight);
      if (homeLat !== '') patch.home_lat = parseFloat(homeLat);
      if (homeLng !== '') patch.home_lng = parseFloat(homeLng);
      if (Object.keys(patch).length) {
        await authFetch('/api/v1/cycling/profile', {
          method: 'PATCH',
          body: JSON.stringify(patch),
        });
      }
      setProfileMsg('Profile saved ✓');
    } catch (err) {
      setProfileMsg(err instanceof Error ? `Save failed: ${err.message}` : 'Save failed');
    } finally {
      setSavingProfile(false);
    }
  };

  const onCreateGoal = async () => {
    if (!metricKey || target === '') return;
    setCreatingGoal(true);
    setGoalMsg(null);
    try {
      const metric = metrics.find((m) => m.key === metricKey);
      const filterJson: Record<string, string> | null = metric?.requires_filter
        ? { [metric.requires_filter[0]]: metric.requires_filter[0] === 'sport' ? 'cycling' : '' }
        : null;
      await createGoal(authFetch, {
        metric: metricKey,
        target_value: parseFloat(target),
        filter_json: filterJson,
      });
      setGoalMsg('Goal created ✓');
    } catch (err) {
      setGoalMsg(err instanceof Error ? `Failed: ${err.message}` : 'Failed to create goal');
    } finally {
      setCreatingGoal(false);
    }
  };

  const handleConnect = (provider: string) => {
    const state = session?.backendToken ? `?state=${encodeURIComponent(session.backendToken)}` : '';
    window.location.href = `/api/v1/auth/oauth/${provider}/authorize${state}`;
  };

  const stepTitle: Record<Step, string> = {
    prefs: 'Welcome',
    connections: 'Connect your apps',
    profile: 'Fitness profile',
    goal: 'First goal (optional)',
    done: 'Done',
  };
  const stepIndex = (['prefs', 'connections', 'profile', 'goal'] as Step[]).indexOf(step) + 1;

  return (
    <>
      {/* Dismissible reopen affordance on the layout is handled by OnboardingToggle. */}

      <Modal
        open={open}
        onClose={step === 'done' ? finish : skip}
        size="lg"
        aria-label="Onboarding"
      >
        <ModalHeader title={stepTitle[step]} onClose={step === 'done' ? finish : skip} icon="👋" />

        {/* Step indicator */}
        <div className="flex items-center gap-1 mb-5">
          {(['prefs', 'connections', 'profile', 'goal'] as Step[]).map((s, i) => (
            <div
              key={s}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                i + 1 <= stepIndex ? 'bg-accent' : 'bg-surface-light'
              }`}
            />
          ))}
        </div>

        {step === 'prefs' && (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Hi {session?.user?.name?.split(' ')[0] || 'there'} 👋 Set your units and format — you
              can change these any time in Settings.
            </p>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="text-sm text-muted">Unit system</span>
              <PillGroup
                value={units.preferences?.unit_system ?? 'metric'}
                options={[
                  { value: 'metric', label: 'Metric (kg, km)' },
                  { value: 'imperial', label: 'Imperial (lb, mi)' },
                ]}
                onChange={(v) => units.setPreference({ unit_system: v as 'metric' | 'imperial' })}
              />
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="text-sm text-muted">Date & number locale</span>
              <PillGroup
                value={units.preferences?.locale ?? 'en-GB'}
                options={[
                  { value: 'en-GB', label: '🇬🇧 en-GB' },
                  { value: 'en-US', label: '🇺🇸 en-US' },
                ]}
                onChange={(v) => units.setPreference({ locale: v as 'en-GB' | 'en-US' })}
              />
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="text-sm text-muted">Time format</span>
              <PillGroup
                value={units.preferences?.time_format ?? '24h'}
                options={[
                  { value: '24h', label: '24-hour (14:35)' },
                  { value: '12h', label: '12-hour (2:35 PM)' },
                ]}
                onChange={(v) => units.setPreference({ time_format: v as '24h' | '12h' })}
              />
            </div>

            <div className="pt-3 flex justify-end gap-2">
              <button onClick={skip} className="px-3 py-2 text-xs rounded-lg border border-surface-light text-muted hover:text-white">
                Skip
              </button>
              <button onClick={next} className="px-4 py-2 text-sm rounded-lg bg-accent text-white font-medium hover:bg-accent/80">
                Continue →
              </button>
            </div>
          </div>
        )}

        {step === 'connections' && (
          <div className="space-y-2">
            <p className="text-sm text-muted mb-2">
              Connect providers to sync activities, sleep, and routes. You can do this later.
            </p>
            {PROVIDERS.map((p) => {
              const conn = connections.find((c) => c.provider === p.id);
              const isConnected = !!conn && conn.status === 'active';
              return (
                <div key={p.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-background border border-surface-light/30">
                  <div className="flex items-center gap-3">
                    <span className="text-xl" aria-hidden>{p.emoji}</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-white font-medium">{p.name}</span>
                        {isConnected && <Badge variant="positive">Connected</Badge>}
                        {conn?.status === 'needs_reauth' && <Badge variant="warning">Re-auth</Badge>}
                      </div>
                      <p className="text-xs text-muted">{p.description}</p>
                    </div>
                  </div>
                  {p.id !== 'komoot' ? (
                    isConnected ? (
                      conn?.status === 'needs_reauth' ? (
                        <button onClick={() => handleConnect(p.id)} className="px-3 py-1.5 text-xs rounded-lg border border-red-500/30 text-warning hover:bg-red-500/10">
                          Reconnect
                        </button>
                      ) : (
                        <span className="px-3 py-1.5 text-xs text-positive">✓</span>
                      )
                    ) : (
                      <button onClick={() => handleConnect(p.id)} className="px-3 py-1.5 text-xs rounded-lg bg-accent text-white font-medium hover:bg-accent/80">
                        Connect
                      </button>
                    )
                  ) : (
                    <span className="text-xs text-muted">Routes sync via env config</span>
                  )}
                </div>
              );
            })}
            {!connLoaded && <p className="text-xs text-muted">Loading connections…</p>}
            <div className="pt-3 flex justify-end gap-2">
              <button onClick={skip} className="px-3 py-2 text-xs rounded-lg border border-surface-light text-muted hover:text-white">
                Skip
              </button>
              <button onClick={next} className="px-4 py-2 text-sm rounded-lg bg-accent text-white font-medium hover:bg-accent/80">
                {connectedCount > 0 ? `Continue (${connectedCount} connected) →` : 'Skip for now →'}
              </button>
            </div>
          </div>
        )}

        {step === 'profile' && (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              These power accuracy features (zones, FTP, projections, weather) — you can leave them
              blank and fill in later.
            </p>
            <Field label="FTP (watts)">
              <input
                type="number" inputMode="decimal" value={ftp} onChange={(e) => setFtp(e.target.value)}
                placeholder="e.g. 250" className={inputCls}
              />
            </Field>
            <Field label={units.isImperial ? 'Weight (lb)' : 'Weight (kg)'}>
              <input
                type="number" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)}
                placeholder={units.isImperial ? 'e.g. 165' : 'e.g. 75'} className={inputCls}
              />
            </Field>
            <div className="flex gap-3">
              <Field label="Home latitude">
                <input type="text" inputMode="decimal" value={homeLat} onChange={(e) => setHomeLat(e.target.value)} placeholder="51.5074" className={inputCls} />
              </Field>
              <Field label="Home longitude">
                <input type="text" inputMode="decimal" value={homeLng} onChange={(e) => setHomeLng(e.target.value)} placeholder="-0.1278" className={inputCls} />
              </Field>
            </div>
            {profileMsg && <p className="text-xs text-muted">{profileMsg}</p>}
            <div className="pt-3 flex justify-end gap-2">
              <button onClick={skip} className="px-3 py-2 text-xs rounded-lg border border-surface-light text-muted hover:text-white">
                Skip
              </button>
              <button onClick={onSaveProfile} disabled={savingProfile} className="px-4 py-2 text-sm rounded-lg bg-accent text-white font-medium hover:bg-accent/80 disabled:opacity-50">
                {savingProfile ? 'Saving…' : 'Save profile'} →
              </button>
            </div>
          </div>
        )}

        {step === 'goal' && (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              Set an optional first goal. You can skip or add more later in Goals.
            </p>
            <Field label="Metric">
              <select
                value={metricKey} onChange={(e) => setMetricKey(e.target.value)} className={`${inputCls} appearance-none`}
              >
                <option value="">Choose a metric…</option>
                {metrics.map((m) => (
                  <option key={m.key} value={m.key}>{m.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Target value">
              <input type="number" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="e.g. 1000" className={inputCls} />
            </Field>
            {goalMsg && <p className="text-xs text-muted">{goalMsg}</p>}
            <div className="pt-3 flex justify-end gap-2">
              <button onClick={finish} className="px-3 py-2 text-xs rounded-lg border border-surface-light text-muted hover:text-white">
                Skip
              </button>
              <button onClick={onCreateGoal} disabled={creatingGoal || !metricKey || target === ''} className="px-4 py-2 text-sm rounded-lg bg-accent text-white font-medium hover:bg-accent/80 disabled:opacity-50">
                {creatingGoal ? 'Creating…' : 'Create goal'}
              </button>
            </div>
          </div>
        )}

        {step === 'done' && (
          <div className="space-y-4 text-center py-4">
            <p className="text-3xl" aria-hidden>🎉</p>
            <p className="text-white font-medium">You're all set!</p>
            <p className="text-sm text-muted">
              You can reopen this anytime from Settings if you'd like to add more.
            </p>
            <div className="flex justify-center">
              <button onClick={finish} className="px-5 py-2 text-sm rounded-lg bg-accent text-white font-medium hover:bg-accent/80">
                Get started
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

/** A "Re-run onboarding" button for the Settings page. */
export function OnboardingToggle() {
  return (
    <button
      onClick={() => window.dispatchEvent(new CustomEvent('fittrack:onboarding'))}
      className="px-4 py-2 text-sm font-medium bg-surface-light hover:bg-surface text-white rounded-lg transition-colors border border-surface-light"
    >
      👋 Re-run onboarding
    </button>
  );
}

const inputCls =
  'w-full px-3 py-2 text-sm bg-background border border-surface-light rounded-lg text-white placeholder-muted focus:outline-none focus:border-accent';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-muted mb-1">{label}</span>
      {children}
    </label>
  );
}

function PillGroup({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-1 p-1 rounded-lg bg-surface-light/30">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
            value === opt.value ? 'bg-accent/20 text-accent' : 'text-muted hover:text-white'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
