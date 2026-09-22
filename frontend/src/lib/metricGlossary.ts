// Central metric glossary for inline explanations (1.6).
//
// MetricCard already supports `tooltip`; StatBadge locals take `hint`.
// Every novel metric (anything a first-time user can't decode from its name)
// must reference an entry here instead of inlining copy.

export const METRIC_GLOSSARY: Record<string, string> = {
  fatigue_index:
    'Performance drop across working sets on a 0–100 scale. Under 40 is fresh, 40–70 is working hard, above 70 suggests cutting volume or adding rest.',
  session_density:
    'Total volume lifted per minute (kg/min). Higher density means more work in less time — compare like-for-like sessions.',
  session_rpe:
    'Whole-session perceived exertion (1–10). Captures overall difficulty beyond any single set.',
  pr_proximity:
    'How close working sets came to your personal record (100% = at PR). Sustained 90%+ weeks need deloads.',
  rep_dropoff:
    'Rep loss from first to last set per exercise (0% = no drop). High dropoff signals accumulated fatigue.',
  power_variability:
    'Standard deviation of power across ride segments (watts). Lower means steadier pacing; surgy group rides read high.',
  decoupling:
    'Heart-rate drift vs power from first to second half. Under 5% is solid aerobic endurance.',
  warmup_flag:
    'Warm-up set — excluded from working volume, 1RM estimates, and progression.',
  forecast_dot:
    'Planned session for that day. Tap a day to see details.',
  max_zone:
    'Hardest zone your current form supports. Set from TSB: fresh weeks unlock Very Hard, fatigued weeks cap lower.',
  alignment:
    'Progress relative to elapsed time (100% = exactly on schedule). Projection answers “will I hit it”; alignment answers “am I ahead”.',
  sleep_debt:
    'Rolling 7-day shortfall vs your 8h target. Shown negative (e.g. −2.6h = 2.6h owed).',
};

export function glossary(key: keyof typeof METRIC_GLOSSARY): string {
  return METRIC_GLOSSARY[key];
}
