'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Card, CardTitle } from '@/components/ui/Card';

// ── Section definitions ──────────────────────────────────────────────────────

const sections = [
  { id: 'overview', label: 'Overview', icon: '🔍' },
  { id: 'getting-started', label: 'Getting Started', icon: '🚀' },
  { id: 'glossary', label: 'Metrics Glossary', icon: '📖' },
  { id: 'science', label: 'Science & Research', icon: '🧪' },
  { id: 'maximizing-impact', label: 'Maximizing Impact', icon: '💡' },
];

// ── Glossary entries (alphabetical) ─────────────────────────────────────────

const glossaryEntries = [
  {
    name: '1RM (One Rep Max)',
    formula: 'weight × (36 / (37 − reps))',
    description:
      'Estimated maximum weight for a single repetition using the Brzycki formula. Accurate for sets of 1–10 reps and used as the benchmark for strength progress.',
  },
  {
    name: 'ATL (Acute Training Load)',
    formula: '7-day EWMA of TSS',
    description:
      'Represents short-term fatigue. Typical range: 30–150. Spikes during intense training blocks and decays quickly during rest.',
  },
  {
    name: 'CTL (Chronic Training Load)',
    formula: '42-day EWMA of TSS',
    description:
      'Represents long-term fitness. Typical range: 40–150 for active cyclists. Builds slowly over weeks and months of consistent training.',
  },
  {
    name: 'Decoupling',
    formula: 'HR-to-power drift across ride halves',
    description:
      '< 3% = excellent aerobic base, 3–5% = acceptable, > 5% = needs endurance work. Measures cardiac drift during prolonged steady-state efforts.',
  },
  {
    name: 'EF (Efficiency Factor)',
    formula: 'Normalized Power ÷ Average Heart Rate',
    description:
      'Higher values indicate greater aerobic efficiency. Improves with fitness over time. Useful for tracking long-term aerobic development.',
  },
  {
    name: 'FTP (Functional Threshold Power)',
    formula: 'Estimated from 20-min test × 0.95',
    description:
      'The highest power you can sustain for approximately one hour, measured in watts. The foundation of all power-based training zones and metrics.',
  },
  {
    name: 'HRV (Heart Rate Variability)',
    formula: 'Measured in milliseconds (ms)',
    description:
      'Variation in time between heartbeats. Higher is generally better and indicates good recovery. Personal baseline matters more than absolute value.',
  },
  {
    name: 'IF (Intensity Factor)',
    formula: 'Normalized Power ÷ FTP',
    description:
      '< 0.75 = endurance, 0.75–0.85 = tempo, 0.85–0.95 = threshold, > 1.05 = VO2max+. A value of 1.0 represents threshold effort.',
  },
  {
    name: 'NP (Normalized Power)',
    formula: '30s rolling avg → 4th power → mean → 4th root',
    description:
      'Weighted average power accounting for variability. Better than average power for reflecting the physiological cost of variable efforts.',
  },
  {
    name: 'Recovery Score',
    formula: 'Whoop metric (0–100%)',
    description:
      'How recovered your body is. Green > 67%, Yellow 34–67%, Red < 34%. Combines HRV, sleep, resting HR, and respiratory rate.',
  },
  {
    name: 'RPE (Rate of Perceived Exertion)',
    formula: 'Subjective scale 1–10',
    description:
      '6–7 = moderate, 8–9 = hard, 10 = maximum. Useful for auto-regulating training intensity based on how you feel on a given day.',
  },
  {
    name: 'Strain',
    formula: 'Whoop metric (0–21)',
    description:
      'Cardiovascular load for the day. Higher values indicate more strain. Derived from heart rate data throughout the day.',
  },
  {
    name: 'TSB (Training Stress Balance)',
    formula: 'CTL − ATL',
    description:
      'Represents form. Positive = fresh, negative = fatigued. −10 to +10 = neutral, < −30 = very fatigued (risk of overtraining), > +20 = very fresh.',
  },
  {
    name: 'TSS (Training Stress Score)',
    formula: '(duration_s × NP × IF) ÷ (FTP × 3600) × 100',
    description:
      '100 TSS ≈ 1 hour at FTP. Combines duration and intensity into a single metric to quantify training load.',
  },
  {
    name: 'VAM (Vertical Ascent Meters)',
    formula: 'elevation_gain ÷ duration_hours',
    description:
      'Meters climbed per hour. Good benchmark: 600–900 m/h for amateur climbers. Useful for comparing climbing performance across rides.',
  },
  {
    name: 'VI (Variability Index)',
    formula: 'NP ÷ Average Power',
    description:
      '1.0 = perfectly steady. > 1.05 = very variable (criterions, group rides). Lower is better for time trials and steady-state efforts.',
  },
  {
    name: 'VO2max',
    formula: 'ACSM power or Uth HR estimation (ml/kg/min)',
    description:
      'Maximum oxygen uptake. > 50 = good, > 60 = excellent for cyclists. Estimated from power and heart rate data; improves with structured training.',
  },
  {
    name: 'Power Zones (Coggan)',
    formula: 'Based on % of FTP',
    description:
      'Z1 Active Recovery (< 55%), Z2 Endurance (55–75%), Z3 Tempo (75–90%), Z4 Threshold (90–105%), Z5 VO2max (105–120%), Z6 Anaerobic (120–150%), Z7 Neuromuscular (> 150%).',
  },
];

// ── Code / formula block ────────────────────────────────────────────────────

function FormulaBlock({ children }: { children: React.ReactNode }) {
  return (
    <code className="block bg-surface-light/60 border border-surface-light rounded-lg px-4 py-3 font-mono text-sm text-accent overflow-x-auto">
      {children}
    </code>
  );
}

// ── Main Wiki Page ───────────────────────────────────────────────────────────

export default function WikiPage() {
  const [activeSection, setActiveSection] = useState('overview');
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Highlight sidebar nav on scroll
  useEffect(() => {
    const headingElements = sections
      .map((s) => document.getElementById(s.id))
      .filter(Boolean) as HTMLElement[];

    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        }
      },
      { rootMargin: '-20% 0px -75% 0px' }
    );

    headingElements.forEach((el) => observerRef.current?.observe(el));

    return () => observerRef.current?.disconnect();
  }, []);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="max-w-7xl mx-auto flex gap-8">
      {/* ── Sticky sidebar nav ────────────────────────────────────── */}
      <aside className="hidden lg:block w-56 shrink-0">
        <nav className="sticky top-8 space-y-1">
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => scrollTo(s.id)}
              className={`w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                activeSection === s.id
                  ? 'bg-accent/20 text-accent border border-accent/30 font-medium'
                  : 'text-muted hover:text-white hover:bg-surface-light/50'
              }`}
            >
              <span aria-hidden="true">{s.icon}</span>
              {s.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* ── Main content ──────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 space-y-10 pb-20">
        {/* Page heading */}
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">FitTrack Wiki</h1>
          <p className="text-muted">
            Everything you need to know about your fitness tracker — from getting started to the science behind the numbers.
          </p>
        </div>

        {/* ─── 1. Overview ──────────────────────────────────────── */}
        <section id="overview">
          <Card>
            <CardTitle>🔍 Overview</CardTitle>
            <div className="space-y-4 text-sm text-muted leading-relaxed">
              <p>
                <strong className="text-white">FitTrack</strong> is a personal fitness tracker designed for{' '}
                <strong className="text-white">powerlifting and cycling</strong> athletes. It aggregates data from
                multiple sources into a single, unified dashboard with deep analytics.
              </p>
              <p>
                Connected integrations: <strong className="text-white">Strava</strong> (rides & activities),{' '}
                <strong className="text-white">Whoop</strong> (recovery, sleep, HRV),{' '}
                <strong className="text-white">Wahoo</strong> (indoor training), and{' '}
                <strong className="text-white">Komoot</strong> (routes & navigation).
              </p>
              <div>
                <h3 className="text-white font-semibold mb-2">Key Features</h3>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    'Dashboard with Today / Weekly / Monthly views',
                    'Automatic activity sync & deduplication',
                    'Lifting session tracking with PR detection',
                    'Route management with maps & surface profiles',
                    'Training load analysis (CTL / ATL / TSB)',
                    'Power curves, zones & FTP estimation',
                    'Health monitoring & early-warning alerts',
                    'AI-powered ride & lifting analysis',
                    'Goals & event tracking',
                    'Structured training plans',
                  ].map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <span className="text-positive mt-0.5" aria-hidden="true">✓</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Card>
        </section>

        {/* ─── 2. Getting Started ───────────────────────────────── */}
        <section id="getting-started">
          <Card>
            <CardTitle>🚀 Getting Started</CardTitle>
            <div className="space-y-6 text-sm text-muted leading-relaxed">
              <div>
                <h3 className="text-white font-semibold mb-2">Connect Your Integrations</h3>
                <ol className="list-decimal list-inside space-y-2">
                  <li>
                    <strong className="text-white">Strava</strong> — Go to <em>Settings → Connections</em> and
                    click "Connect Strava". Authorise FitTrack to read your activities. All rides and runs
                    will sync automatically.
                  </li>
                  <li>
                    <strong className="text-white">Whoop</strong> — Connect via OAuth in Settings. FitTrack imports
                    recovery scores, HRV, sleep data, and strain metrics.
                  </li>
                  <li>
                    <strong className="text-white">Wahoo</strong> — Link your Wahoo account for indoor trainer
                    rides and structured workout data.
                  </li>
                  <li>
                    <strong className="text-white">Komoot</strong> — Connect for route planning data and
                    turn-by-turn navigation imports.
                  </li>
                </ol>
              </div>

              <div>
                <h3 className="text-white font-semibold mb-2">First Sync & Backfill</h3>
                <p>
                  After connecting an integration, FitTrack performs an initial sync of recent activities. For a
                  complete history, use the <strong className="text-white">Backfill</strong> feature in Settings
                  to import all historical data. This may take a few minutes depending on your account history.
                </p>
              </div>

              <div>
                <h3 className="text-white font-semibold mb-2">Set Up Your Cycling Profile</h3>
                <p>
                  Navigate to <em>Settings → Cycling Profile</em> and enter:
                </p>
                <ul className="list-disc list-inside mt-2 space-y-1">
                  <li><strong className="text-white">FTP</strong> — Your Functional Threshold Power in watts (from a 20-min test or ramp test).</li>
                  <li><strong className="text-white">Weight</strong> — Your body weight in kg (used for W/kg calculations).</li>
                  <li><strong className="text-white">LTHR</strong> — Lactate Threshold Heart Rate (used for heart rate zones).</li>
                </ul>
                <p className="mt-2">
                  Optionally enable <strong className="text-white">auto-FTP estimation</strong> to let FitTrack
                  calculate your FTP from recent hard efforts.
                </p>
              </div>

              <div>
                <h3 className="text-white font-semibold mb-2">Understanding the Dashboard</h3>
                <p>
                  The dashboard has three time-range tabs: <strong className="text-white">Today</strong> for a quick
                  snapshot (recovery, strain, recent activities), <strong className="text-white">Weekly</strong> for
                  aggregated metrics and trends, and <strong className="text-white">Monthly</strong> for long-term
                  progress overview.
                </p>
              </div>
            </div>
          </Card>
        </section>

        {/* ─── 3. Metrics Glossary ─────────────────────────────── */}
        <section id="glossary">
          <Card>
            <CardTitle>📖 Metrics Glossary</CardTitle>
            <p className="text-sm text-muted mb-6">
              All metrics tracked or calculated by FitTrack, listed alphabetically.
            </p>
            <div className="space-y-4">
              {glossaryEntries.map((entry) => (
                <div
                  key={entry.name}
                  className="border border-surface-light/50 rounded-lg p-4"
                >
                  <h3 className="text-white font-semibold text-sm mb-1">{entry.name}</h3>
                  <FormulaBlock>{entry.formula}</FormulaBlock>
                  <p className="text-sm text-muted mt-2">{entry.description}</p>
                </div>
              ))}
            </div>
          </Card>
        </section>

        {/* ─── 4. Science & Research ────────────────────────────── */}
        <section id="science">
          <Card>
            <CardTitle>🧪 Science & Research</CardTitle>
            <div className="space-y-8 text-sm text-muted leading-relaxed">
              {/* Training Load Model */}
              <div>
                <h3 className="text-white font-semibold mb-2">Training Load Model (CTL / ATL / TSB)</h3>
                <p>
                  Based on the <strong className="text-white">Banister impulse-response model</strong>, FitTrack uses
                  exponentially weighted moving averages (EWMA) with time constants of{' '}
                  <strong className="text-white">42 days</strong> for chronic/fitness (CTL) and{' '}
                  <strong className="text-white">7 days</strong> for acute/fatigue (ATL). TSB = CTL − ATL represents
                  the balance between fitness and fatigue. Research shows CTL correlates strongly with
                  performance capacity — athletes with higher CTL can sustain higher workloads.
                </p>
                <div className="mt-3">
                  <FormulaBlock>CTL_today = TSS × (1 − e^(−1/42)) + CTL_yesterday × e^(−1/42)</FormulaBlock>
                </div>
              </div>

              {/* Normalized Power */}
              <div>
                <h3 className="text-white font-semibold mb-2">Normalized Power Algorithm</h3>
                <p>
                  Developed by <strong className="text-white">Andrew Coggan</strong>. The algorithm:
                </p>
                <ol className="list-decimal list-inside mt-2 space-y-1">
                  <li>Calculate the 30-second rolling average of power.</li>
                  <li>Raise each value to the 4th power.</li>
                  <li>Average all resulting values.</li>
                  <li>Take the 4th root of the average.</li>
                </ol>
                <p className="mt-2">
                  This weighting emphasizes high-intensity efforts, reflecting their disproportionate
                  physiological cost. A 30-second sprint at 600 W impacts the body far more than the same
                  duration at 100 W, and the 4th-power weighting captures this non-linear relationship.
                </p>
                <div className="mt-3">
                  <FormulaBlock>NP = (1/n × Σ P_rolling30⁴) ^ 0.25</FormulaBlock>
                </div>
              </div>

              {/* FTP Estimation */}
              <div>
                <h3 className="text-white font-semibold mb-2">FTP Estimation</h3>
                <p>FitTrack uses multiple methods with confidence weighting:</p>
                <ul className="list-disc list-inside mt-2 space-y-1">
                  <li><strong className="text-white">20-min power × 0.95</strong> — Gold standard field test.</li>
                  <li><strong className="text-white">8-min power × 0.90 × 0.95</strong> — Two-trial average method.</li>
                  <li><strong className="text-white">5-min power × 0.95</strong> — Shorter test variant.</li>
                  <li><strong className="text-white">60-min power</strong> — Direct measurement (rare in practice).</li>
                  <li><strong className="text-white">Riegel extrapolation</strong> — Uses shorter efforts to estimate longer power output.</li>
                </ul>
                <div className="mt-3">
                  <FormulaBlock>P₂ = P₁ × (D₁ / D₂)^0.06</FormulaBlock>
                </div>
              </div>

              {/* Brzycki 1RM */}
              <div>
                <h3 className="text-white font-semibold mb-2">Brzycki 1RM Formula</h3>
                <p>
                  One of the most validated rep-max formulas in strength training research. Accurate for sets of
                  1–10 reps. Used throughout FitTrack for PR tracking and progress monitoring.
                </p>
                <div className="mt-3">
                  <FormulaBlock>1RM = weight × (36 / (37 − reps))</FormulaBlock>
                </div>
              </div>

              {/* TSS Calculation */}
              <div>
                <h3 className="text-white font-semibold mb-2">TSS Calculation</h3>
                <p>
                  Power-based TSS combines duration and intensity into a single metric. A score of{' '}
                  <strong className="text-white">100 TSS</strong> corresponds to approximately one hour at FTP
                  intensity. Heart-rate-based TSS uses percentage of HR reserve when power data is unavailable.
                </p>
                <div className="mt-3">
                  <FormulaBlock>TSS = (duration_s × NP × NP/FTP) ÷ (FTP × 3600) × 100</FormulaBlock>
                </div>
              </div>

              {/* Cardiac Drift */}
              <div>
                <h3 className="text-white font-semibold mb-2">Cardiac Drift / Decoupling</h3>
                <p>
                  During prolonged exercise, heart rate gradually increases at constant power due to{' '}
                  <strong className="text-white">dehydration</strong>, <strong className="text-white">glycogen depletion</strong>,
                  and <strong className="text-white">rising core temperature</strong>. Decoupling measures the %
                  difference between first-half and second-half Efficiency Factor, indicating aerobic fitness
                  and endurance base robustness.
                </p>
              </div>

              {/* Power Zones */}
              <div>
                <h3 className="text-white font-semibold mb-2">Power Zones (Coggan 7-Zone Model)</h3>
                <p>
                  Based on FTP as the anchor point. Each zone represents a distinct physiological adaptation:
                </p>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-surface-light/50">
                        <th className="text-left py-2 pr-4 text-white font-medium">Zone</th>
                        <th className="text-left py-2 pr-4 text-white font-medium">% FTP</th>
                        <th className="text-left py-2 text-white font-medium">Adaptation</th>
                      </tr>
                    </thead>
                    <tbody className="text-muted">
                      <tr className="border-b border-surface-light/30">
                        <td className="py-2 pr-4 text-white">Z1 Active Recovery</td>
                        <td className="py-2 pr-4">{"< 55%"}</td>
                        <td className="py-2">Active recovery, blood flow</td>
                      </tr>
                      <tr className="border-b border-surface-light/30">
                        <td className="py-2 pr-4 text-white">Z2 Endurance</td>
                        <td className="py-2 pr-4">55–75%</td>
                        <td className="py-2">Fat oxidation, aerobic base</td>
                      </tr>
                      <tr className="border-b border-surface-light/30">
                        <td className="py-2 pr-4 text-white">Z3 Tempo</td>
                        <td className="py-2 pr-4">75–90%</td>
                        <td className="py-2">Lactate clearance, muscular endurance</td>
                      </tr>
                      <tr className="border-b border-surface-light/30">
                        <td className="py-2 pr-4 text-white">Z4 Threshold</td>
                        <td className="py-2 pr-4">90–105%</td>
                        <td className="py-2">Lactate threshold improvement</td>
                      </tr>
                      <tr className="border-b border-surface-light/30">
                        <td className="py-2 pr-4 text-white">Z5 VO2max</td>
                        <td className="py-2 pr-4">105–120%</td>
                        <td className="py-2">Maximal aerobic capacity</td>
                      </tr>
                      <tr className="border-b border-surface-light/30">
                        <td className="py-2 pr-4 text-white">Z6 Anaerobic</td>
                        <td className="py-2 pr-4">120–150%</td>
                        <td className="py-2">Anaerobic capacity, lactate tolerance</td>
                      </tr>
                      <tr>
                        <td className="py-2 pr-4 text-white">Z7 Neuromuscular</td>
                        <td className="py-2 pr-4">{"> 150%"}</td>
                        <td className="py-2">Neuromuscular power, sprinting</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </Card>
        </section>

        {/* ─── 5. Maximizing Impact ────────────────────────────── */}
        <section id="maximizing-impact">
          <Card>
            <CardTitle>💡 Maximizing Impact</CardTitle>
            <div className="space-y-4 text-sm text-muted leading-relaxed">
              {[
                {
                  title: 'Connect All Your Devices',
                  text: 'The more data sources, the better the analysis. Use Strava for outdoor rides, Whoop for recovery and sleep, and Wahoo for indoor training sessions.',
                },
                {
                  title: 'Set Your FTP Accurately',
                  text: 'Enable auto-FTP estimation in Settings or perform a 20-minute maximal effort test. All power-based metrics depend on an accurate FTP value.',
                },
                {
                  title: 'Check the Dashboard Daily',
                  text: 'Use the Today tab for a quick status check (recovery, strain, recent activities) and the Weekly view for tracking trends and patterns.',
                },
                {
                  title: 'Monitor Your TSB',
                  text: 'Aim to keep TSB between −10 and −30 for productive training. Below −30 risks overtraining; above +20 may indicate detraining. Adjust volume accordingly.',
                },
                {
                  title: 'Use AI Analysis',
                  text: 'Run the AI coach weekly or after important sessions for personalised insights on pacing, form, and training recommendations.',
                },
                {
                  title: 'Track Every Lifting Session',
                  text: 'Log all lifting sessions — even light ones — for accurate PR detection, volume tracking, and long-term strength progress analysis.',
                },
                {
                  title: 'Review Session Analysis',
                  text: 'After each ride or lifting session, review the analysis card for zone distribution, pacing breakdown, fatigue patterns, and recovery recommendations.',
                },
                {
                  title: 'Set Goals',
                  text: 'Use the Goals feature to define specific targets (weight, FTP, PRs) and track your progress with visual indicators and projections.',
                },
                {
                  title: 'Watch Health Alerts',
                  text: 'The health monitor detects early signs of overtraining, injury risk, and illness through HRV decline, sleep disruption, and respiratory rate elevation.',
                },
                {
                  title: 'Backfill Historical Data',
                  text: 'After connecting Strava or Whoop, use the backfill feature in Settings to import your complete training history for comprehensive trend analysis.',
                },
              ].map((tip) => (
                <div key={tip.title} className="flex items-start gap-3">
                  <span className="text-positive text-lg mt-0.5 shrink-0" aria-hidden="true">▸</span>
                  <div>
                    <h3 className="text-white font-semibold">{tip.title}</h3>
                    <p>{tip.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </section>
      </div>
    </div>
  );
}