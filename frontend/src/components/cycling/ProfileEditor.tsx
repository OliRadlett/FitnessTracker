import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import type { CyclingProfile, CyclingProfileUpdate, FtpEstimate } from '@/lib/api';

export function ProfileEditor({
  profile,
  onSave,
  isSaving,
  onEstimateFtp,
  ftpEstimate,
  isEstimating,
  onAcceptEstimate,
  saveMessage,
}: {
  profile: CyclingProfile | undefined;
  onSave: (data: CyclingProfileUpdate) => void;
  isSaving: boolean;
  onEstimateFtp: () => void;
  ftpEstimate: FtpEstimate | null;
  isEstimating: boolean;
  onAcceptEstimate: () => void;
  saveMessage: string | null;
}) {
  const [ftp, setFtp] = useState('');
  const [weight, setWeight] = useState('');
  const [initialized, setInitialized] = useState(false);

  // Sync local state when profile loads (once)
  useEffect(() => {
    if (profile && !initialized) {
      if (profile.ftp_watts) setFtp(profile.ftp_watts.toString());
      if (profile.weight_kg) setWeight(profile.weight_kg.toString());
      setInitialized(true);
    }
  }, [profile, initialized]);

  const handleAutoEstimateToggle = () => {
    if (!profile) return;
    onSave({ auto_estimate_ftp: !profile.auto_estimate_ftp });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cycling Profile</CardTitle>
      </CardHeader>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
        <div>
          <label className="block text-xs text-muted mb-1">FTP (watts)</label>
          <input
            type="number"
            value={ftp}
            onChange={(e) => setFtp(e.target.value)}
            placeholder="e.g. 250"
            className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">Weight (kg)</label>
          <input
            type="number"
            step="0.1"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder="e.g. 75"
            className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <button
          onClick={() => {
            const payload: CyclingProfileUpdate = {};
            if (ftp) payload.ftp_watts = parseFloat(ftp);
            if (weight) payload.weight_kg = parseFloat(weight);
            onSave(payload);
          }}
          disabled={isSaving}
          className="px-4 py-2 bg-accent text-white text-sm font-medium rounded-lg hover:bg-accent/80 transition-colors disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>
      </div>
      {saveMessage && (
        <p className={`text-xs mt-2 ${saveMessage.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>
          {saveMessage}
        </p>
      )}

      {/* Auto FTP Estimation Toggle */}
      <div className="mt-4 pt-4 border-t border-surface-light/30">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-white">Weekly Auto FTP Estimation</p>
            <p className="text-xs text-muted mt-0.5">
              Automatically estimates and updates your FTP every week from power data
            </p>
          </div>
          <button
            onClick={handleAutoEstimateToggle}
            disabled={isSaving}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              profile?.auto_estimate_ftp ? 'bg-accent' : 'bg-surface-light'
            } ${isSaving ? 'opacity-50' : ''}`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                profile?.auto_estimate_ftp ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Manual Auto-estimate FTP */}
      <div className="mt-4 pt-4 border-t border-surface-light/30">
        <div className="flex items-center gap-3 mb-2">
          <button
            onClick={onAcceptEstimate}
            disabled={isEstimating}
            className="px-3 py-1.5 text-xs bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 rounded-lg hover:bg-yellow-500/30 transition-colors disabled:opacity-50"
          >
            {isEstimating ? 'Calculating...' : '⚡ Auto-Estimate & Save FTP'}
          </button>
          <span className="text-xs text-muted">
            Estimates from best 20-min power (×0.95) and saves automatically
          </span>
        </div>

        {/* Estimate result */}
        {ftpEstimate && (
          <div className={`p-3 rounded-lg border ${
            ftpEstimate.accepted
              ? 'bg-green-500/10 border-green-500/20'
              : 'bg-yellow-500/10 border-yellow-500/20'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-sm font-medium text-white">
                  Estimated FTP: <span className="text-yellow-400 font-mono text-lg">{ftpEstimate.estimated_ftp} W</span>
                </p>
                {ftpEstimate.source_method && (
                  <p className="text-xs text-muted mt-0.5">Method: {ftpEstimate.source_method}</p>
                )}
              </div>
              {!ftpEstimate.accepted && (
                <button
                  onClick={onAcceptEstimate}
                  className="px-3 py-1.5 text-xs bg-green-500/20 text-green-400 border border-green-500/30 rounded-lg hover:bg-green-500/30 transition-colors"
                >
                  ✓ Accept & Save
                </button>
              )}
              {ftpEstimate.accepted && (
                <span className="text-xs text-green-400 font-medium">✓ Saved as FTP</span>
              )}
            </div>

            {/* Best power breakdown */}
            {ftpEstimate.best_power_available && (
              <div className="flex flex-wrap gap-3 mt-2">
                {Object.entries(ftpEstimate.best_power_available).map(([duration, power]) => (
                  power ? (
                    <div key={duration} className="text-xs">
                      <span className="text-muted">{duration}: </span>
                      <span className="font-mono text-white">{power} W</span>
                    </div>
                  ) : null
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
