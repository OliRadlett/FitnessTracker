'use client';

import React from 'react';
import type { HealthAnalysisResult } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';

interface HealthAlertsSectionProps {
  analysisResults: HealthAnalysisResult[] | null;
  isAnalyzing: boolean;
  onAnalyze: () => void;
}

export function HealthAlertsSection({ analysisResults, isAnalyzing, onAnalyze }: HealthAlertsSectionProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between w-full">
          <CardTitle>🛡️ Health Monitor</CardTitle>
          <button
            onClick={onAnalyze}
            disabled={isAnalyzing}
            aria-label="Run health analysis"
            className="px-3 py-1.5 text-xs bg-accent/20 text-accent border border-accent/30 rounded-lg hover:bg-accent/30 transition-colors disabled:opacity-50"
          >
            {isAnalyzing ? '⏳ Analyzing...' : '🔍 Analyze Now'}
          </button>
        </div>
      </CardHeader>
      {analysisResults && analysisResults.length > 0 ? (
        <div className="space-y-3">
          {analysisResults.map((item, i) => {
            const severity = item.result?.severity || 'none';
            const borderClass = severity === 'critical' ? 'border-red-500/30 bg-red-500/10'
              : severity === 'warning' ? 'border-yellow-500/30 bg-yellow-500/10'
              : severity === 'info' ? 'border-blue-500/30 bg-blue-500/10'
              : 'border-green-500/20 bg-green-500/5';
            const badgeClass = severity === 'critical' ? 'bg-red-500/20 text-red-400'
              : severity === 'warning' ? 'bg-yellow-500/20 text-yellow-400'
              : severity === 'info' ? 'bg-blue-500/20 text-blue-400'
              : 'bg-green-500/20 text-green-400';
            const badgeText = severity === 'none' ? '✅ OK'
              : severity === 'info' ? 'ℹ️ INFO'
              : severity.toUpperCase();

            return (
              <div key={i} className={`p-3 rounded-lg border ${borderClass}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-white">{item.label}</span>
                  <span className={`text-xs px-2 py-0.5 rounded ${badgeClass}`}>{badgeText}</span>
                </div>
                {item.result?.description && (
                  <p className="text-xs text-slate-300 mt-1">{item.result.description}</p>
                )}
                {item.result?.evidence && Object.keys(item.result.evidence).length > 0 && (
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                    {Object.entries(item.result.evidence).map(([key, value]) => (
                      <div key={key} className="flex justify-between text-xs gap-2">
                        <span className="text-muted truncate">{key}</span>
                        <span className="text-slate-300 font-mono whitespace-nowrap">
                          {typeof value === 'number' ? value.toFixed(0) : String(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {item.error && (
                  <p className="text-xs text-red-400 mt-1">Error: {item.error}</p>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-6">
          <p className="text-3xl mb-2">🏥</p>
          <p className="text-muted text-sm">Click "Analyze Now" for a comprehensive health check</p>
          <p className="text-muted text-xs mt-1">Checks overtraining risk, injury risk, and illness indicators</p>
        </div>
      )}
    </Card>
  );
}
