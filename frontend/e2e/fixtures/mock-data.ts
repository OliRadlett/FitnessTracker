/**
 * Mock API responses for FitTrack E2E tests.
 *
 * Each export corresponds to a backend endpoint and returns realistic data
 * matching the TypeScript types in `frontend/src/lib/api/types/`.
 */

// ─── Dashboard ───────────────────────────────────────────────────────────────

export const mockTodaySummary = {
  today_activities: [
    {
      id: 'act-today-1',
      name: 'Morning Ride',
      sport_type: 'cycling',
      start_date: new Date().toISOString(),
      duration_seconds: 3600,
      distance_meters: 35000,
      average_power: 210,
      normalized_power: 225,
      average_heartrate: 145,
      tss: 85,
      calories: 650,
    },
  ],
  today_lifting_sessions: [
    {
      id: 'lift-today-1',
      session_date: new Date().toISOString().split('T')[0],
      focus: 'Upper Body',
      duration_seconds: 2700,
      rpe_session: 7,
      total_volume_kg: 5400,
      sets_count: 12,
    },
  ],
  today_tss: 85,
  today_volume_kg: 5400,
  today_distance_meters: 35000,
  today_duration_seconds: 6300,
  latest_recovery: 72,
  latest_hrv_ms: 55,
  latest_strain: 12.5,
  latest_sleep_hours: 7.5,
  current_ctl: 65,
  current_atl: 72,
  current_tsb: -7,
  active_alerts: 0,
};

export const mockDashboardSummary = {
  weekly_volume_kg: 28500,
  weekly_sessions: 5,
  weekly_tss: 420,
  weekly_distance_meters: 185000,
  latest_recovery: 72,
  latest_hrv_ms: 55,
  latest_strain: 12.5,
  active_alerts_count: 0,
  current_week_start: '2026-08-17',
  current_week_end: '2026-08-23',
  rest_day_suggestion: {
    should_rest: false,
    reasons: [],
    current_tsb: -7,
    consecutive_training_days: 3,
  },
};

export const mockWeeklyReport = {
  week_start: '2026-08-17',
  week_end: '2026-08-23',
  lifting_sessions: 3,
  lifting_volume_kg: 28500,
  cardio_sessions: 4,
  total_tss: 420,
  avg_recovery: 68,
  avg_hrv_ms: 52,
  avg_sleep_hours: 7.2,
  new_prs: 1,
};

export const mockMonthlySummary = [
  {
    month: '2026-08',
    total_tss: 1200,
    lifting_volume_kg: 85000,
    total_distance_meters: 520000,
    total_time_seconds: 72000,
    lifting_sessions: 12,
    cardio_sessions: 16,
    pr_count: 3,
    avg_recovery: 68,
  },
  {
    month: '2026-07',
    total_tss: 1450,
    lifting_volume_kg: 92000,
    total_distance_meters: 610000,
    total_time_seconds: 84000,
    lifting_sessions: 14,
    cardio_sessions: 18,
    pr_count: 5,
    avg_recovery: 71,
  },
  {
    month: '2026-06',
    total_tss: 1100,
    lifting_volume_kg: 78000,
    total_distance_meters: 480000,
    total_time_seconds: 65000,
    lifting_sessions: 11,
    cardio_sessions: 14,
    pr_count: 2,
    avg_recovery: 65,
  },
];

export const mockTrainingStreaks = {
  current_streak_days: 5,
  longest_streak_days: 21,
  weekly_consistency_pct: 85,
  monthly_sessions: [
    { month: '2026-06', sessions: 18 },
    { month: '2026-07', sessions: 22 },
    { month: '2026-08', sessions: 15 },
  ],
};

export const mockYearlySummary = {
  year: 2026,
  total_activities: 180,
  total_distance_m: 4500000,
  total_time_s: 720000,
  total_tss: 12000,
  total_lifting_sessions: 96,
  total_lifting_volume_kg: 750000,
  avg_recovery: 68,
  avg_hrv_ms: 52,
  months: mockMonthlySummary,
  highlights: {
    best_month_tss: '2026-07',
    best_month_tss_value: 1450,
    longest_ride: {
      name: 'Century Ride',
      sport_type: 'cycling',
      start_date: '2026-07-15T08:00:00Z',
      value: 162000,
      unit: 'meters',
    },
    heaviest_lift: {
      name: 'Squat PR',
      sport_type: 'weighttraining',
      start_date: '2026-07-20T10:00:00Z',
      value: 180,
      unit: 'kg',
    },
    total_prs: 12,
    pr_highlights: [
      {
        exercise_name: 'Squat',
        record_type: '1rm',
        weight_kg: 180,
        reps: 1,
        estimated_1rm: 180,
        achieved_date: '2026-07-20',
      },
    ],
  },
};

// ─── Activities ──────────────────────────────────────────────────────────────

export const mockActivities = [
  {
    id: 'act-1',
    user_id: 'user-1',
    source: 'strava',
    sport_type: 'cycling',
    name: 'Morning Ride — Surrey Hills',
    start_date: '2026-08-20T07:00:00Z',
    duration_seconds: 5400,
    distance_meters: 42000,
    elevation_gain_meters: 650,
    average_heartrate: 148,
    max_heartrate: 182,
    average_power: 215,
    normalized_power: 232,
    average_speed: 28.0,
    tss: 95,
    calories: 780,
    encoded_polyline: 'encoded_polyline_data_here',
    sources: [{ id: 'src-1', provider: 'strava', provider_activity_id: '12345', provider_name: 'Morning Ride', synced_at: '2026-08-20T08:00:00Z' }],
    synced_at: '2026-08-20T08:00:00Z',
    created_at: '2026-08-20T08:00:00Z',
    updated_at: '2026-08-20T08:00:00Z',
  },
  {
    id: 'act-2',
    user_id: 'user-1',
    source: 'strava',
    sport_type: 'cycling',
    name: 'Evening Commute',
    start_date: '2026-08-19T17:30:00Z',
    duration_seconds: 2700,
    distance_meters: 18500,
    elevation_gain_meters: 120,
    average_heartrate: 135,
    average_power: 185,
    average_speed: 24.7,
    tss: 45,
    calories: 420,
    sources: [{ id: 'src-2', provider: 'strava', provider_activity_id: '12344', synced_at: '2026-08-19T18:00:00Z' }],
    synced_at: '2026-08-19T18:00:00Z',
    created_at: '2026-08-19T18:00:00Z',
    updated_at: '2026-08-19T18:00:00Z',
  },
  {
    id: 'act-3',
    user_id: 'user-1',
    source: 'strava',
    sport_type: 'running',
    name: 'Park Run 5K',
    start_date: '2026-08-18T09:00:00Z',
    duration_seconds: 1500,
    distance_meters: 5000,
    elevation_gain_meters: 25,
    average_heartrate: 165,
    max_heartrate: 185,
    average_speed: 12.0,
    tss: 55,
    calories: 380,
    sources: [{ id: 'src-3', provider: 'strava', provider_activity_id: '12343', synced_at: '2026-08-18T10:00:00Z' }],
    synced_at: '2026-08-18T10:00:00Z',
    created_at: '2026-08-18T10:00:00Z',
    updated_at: '2026-08-18T10:00:00Z',
  },
  {
    id: 'act-4',
    user_id: 'user-1',
    source: 'wahoo',
    sport_type: 'cycling',
    name: 'Indoor Trainer Session',
    start_date: '2026-08-17T06:00:00Z',
    duration_seconds: 3600,
    distance_meters: 0,
    average_heartrate: 152,
    average_power: 225,
    normalized_power: 230,
    tss: 88,
    calories: 620,
    sources: [{ id: 'src-4', provider: 'wahoo', provider_activity_id: 'wahoo-123', synced_at: '2026-08-17T07:00:00Z' }],
    synced_at: '2026-08-17T07:00:00Z',
    created_at: '2026-08-17T07:00:00Z',
    updated_at: '2026-08-17T07:00:00Z',
  },
  {
    id: 'act-5',
    user_id: 'user-1',
    source: 'strava',
    sport_type: 'weighttraining',
    name: 'Upper Body Session',
    start_date: '2026-08-16T10:00:00Z',
    duration_seconds: 3300,
    calories: 450,
    sources: [{ id: 'src-5', provider: 'strava', provider_activity_id: '12341', synced_at: '2026-08-16T11:00:00Z' }],
    synced_at: '2026-08-16T11:00:00Z',
    created_at: '2026-08-16T11:00:00Z',
    updated_at: '2026-08-16T11:00:00Z',
  },
  {
    id: 'act-6',
    user_id: 'user-1',
    source: 'komoot',
    sport_type: 'hiking',
    name: 'South Downs Walk',
    start_date: '2026-08-15T08:30:00Z',
    duration_seconds: 7200,
    distance_meters: 15000,
    elevation_gain_meters: 420,
    average_heartrate: 110,
    calories: 520,
    sources: [{ id: 'src-6', provider: 'komoot', provider_activity_id: 'kmt-456', synced_at: '2026-08-15T12:00:00Z' }],
    synced_at: '2026-08-15T12:00:00Z',
    created_at: '2026-08-15T12:00:00Z',
    updated_at: '2026-08-15T12:00:00Z',
  },
  {
    id: 'act-7',
    user_id: 'user-1',
    source: 'strava',
    sport_type: 'swimming',
    name: 'Pool Swim — 2km',
    start_date: '2026-08-14T07:00:00Z',
    duration_seconds: 2400,
    distance_meters: 2000,
    average_heartrate: 130,
    calories: 350,
    sources: [{ id: 'src-7', provider: 'strava', provider_activity_id: '12339', synced_at: '2026-08-14T08:00:00Z' }],
    synced_at: '2026-08-14T08:00:00Z',
    created_at: '2026-08-14T08:00:00Z',
    updated_at: '2026-08-14T08:00:00Z',
  },
];

// ─── Lifting ─────────────────────────────────────────────────────────────────

export const mockLiftingSessions = [
  {
    id: 'lift-1',
    user_id: 'user-1',
    session_date: '2026-08-20',
    focus: 'Squat Day',
    duration_seconds: 3600,
    total_volume_kg: 8500,
    rpe_session: 8,
    notes: 'Felt strong today',
    sets: [
      { id: 'set-1', session_id: 'lift-1', exercise_name: 'Squat', set_number: 1, weight_kg: 120, reps: 5, rpe: 7, is_warmup: false, is_amrap: false },
      { id: 'set-2', session_id: 'lift-1', exercise_name: 'Squat', set_number: 2, weight_kg: 140, reps: 5, rpe: 8, is_warmup: false, is_amrap: false },
      { id: 'set-3', session_id: 'lift-1', exercise_name: 'Squat', set_number: 3, weight_kg: 160, reps: 3, rpe: 9, is_warmup: false, is_amrap: true },
      { id: 'set-4', session_id: 'lift-1', exercise_name: 'Romanian Deadlift', set_number: 1, weight_kg: 100, reps: 8, rpe: 7, is_warmup: false, is_amrap: false },
      { id: 'set-5', session_id: 'lift-1', exercise_name: 'Romanian Deadlift', set_number: 2, weight_kg: 100, reps: 8, rpe: 7, is_warmup: false, is_amrap: false },
      { id: 'set-6', session_id: 'lift-1', exercise_name: 'Leg Press', set_number: 1, weight_kg: 200, reps: 10, rpe: 7, is_warmup: false, is_amrap: false },
    ],
    linked_activity: null,
    created_at: '2026-08-20T10:00:00Z',
    updated_at: '2026-08-20T10:00:00Z',
  },
  {
    id: 'lift-2',
    user_id: 'user-1',
    session_date: '2026-08-18',
    focus: 'Bench Day',
    duration_seconds: 3300,
    total_volume_kg: 6200,
    rpe_session: 7,
    notes: '',
    sets: [
      { id: 'set-7', session_id: 'lift-2', exercise_name: 'Bench Press', set_number: 1, weight_kg: 80, reps: 5, rpe: 7, is_warmup: false, is_amrap: false },
      { id: 'set-8', session_id: 'lift-2', exercise_name: 'Bench Press', set_number: 2, weight_kg: 90, reps: 5, rpe: 8, is_warmup: false, is_amrap: false },
      { id: 'set-9', session_id: 'lift-2', exercise_name: 'Bench Press', set_number: 3, weight_kg: 100, reps: 3, rpe: 9, is_warmup: false, is_amrap: true },
      { id: 'set-10', session_id: 'lift-2', exercise_name: 'Overhead Press', set_number: 1, weight_kg: 50, reps: 8, rpe: 7, is_warmup: false, is_amrap: false },
      { id: 'set-11', session_id: 'lift-2', exercise_name: 'Barbell Row', set_number: 1, weight_kg: 70, reps: 8, rpe: 7, is_warmup: false, is_amrap: false },
    ],
    linked_activity: null,
    created_at: '2026-08-18T10:00:00Z',
    updated_at: '2026-08-18T10:00:00Z',
  },
  {
    id: 'lift-3',
    user_id: 'user-1',
    session_date: '2026-08-16',
    focus: 'Deadlift Day',
    duration_seconds: 3000,
    total_volume_kg: 7800,
    rpe_session: 9,
    notes: 'PR attempt',
    sets: [
      { id: 'set-12', session_id: 'lift-3', exercise_name: 'Deadlift', set_number: 1, weight_kg: 140, reps: 5, rpe: 7, is_warmup: false, is_amrap: false },
      { id: 'set-13', session_id: 'lift-3', exercise_name: 'Deadlift', set_number: 2, weight_kg: 170, reps: 3, rpe: 8, is_warmup: false, is_amrap: false },
      { id: 'set-14', session_id: 'lift-3', exercise_name: 'Deadlift', set_number: 3, weight_kg: 200, reps: 1, rpe: 10, is_warmup: false, is_amrap: true },
      { id: 'set-15', session_id: 'lift-3', exercise_name: 'Pull-ups', set_number: 1, weight_kg: 0, reps: 10, rpe: 7, is_warmup: false, is_amrap: false },
    ],
    linked_activity: null,
    created_at: '2026-08-16T10:00:00Z',
    updated_at: '2026-08-16T10:00:00Z',
  },
];

export const mockPersonalRecords = [
  {
    id: 'pr-1',
    user_id: 'user-1',
    exercise_name: 'Squat',
    record_type: '1rm',
    weight_kg: 180,
    reps: 1,
    estimated_1rm: 180,
    achieved_date: '2026-07-20',
    notes: 'Competition PR',
    created_at: '2026-07-20T10:00:00Z',
  },
  {
    id: 'pr-2',
    user_id: 'user-1',
    exercise_name: 'Bench Press',
    record_type: '1rm',
    weight_kg: 110,
    reps: 1,
    estimated_1rm: 110,
    achieved_date: '2026-07-15',
    created_at: '2026-07-15T10:00:00Z',
  },
  {
    id: 'pr-3',
    user_id: 'user-1',
    exercise_name: 'Deadlift',
    record_type: '1rm',
    weight_kg: 220,
    reps: 1,
    estimated_1rm: 220,
    achieved_date: '2026-08-16',
    notes: 'New PR!',
    created_at: '2026-08-16T10:00:00Z',
  },
];

export const mockVolumeTrends = {
  data: [
    { week_start: '2026-06-01', total_volume_kg: 22000, session_count: 3 },
    { week_start: '2026-06-08', total_volume_kg: 25000, session_count: 3 },
    { week_start: '2026-06-15', total_volume_kg: 23500, session_count: 3 },
    { week_start: '2026-06-22', total_volume_kg: 27000, session_count: 4 },
    { week_start: '2026-06-29', total_volume_kg: 26000, session_count: 3 },
    { week_start: '2026-07-06', total_volume_kg: 28000, session_count: 4 },
    { week_start: '2026-07-13', total_volume_kg: 30000, session_count: 4 },
    { week_start: '2026-07-20', total_volume_kg: 29000, session_count: 3 },
    { week_start: '2026-07-27', total_volume_kg: 27500, session_count: 3 },
    { week_start: '2026-08-03', total_volume_kg: 31000, session_count: 4 },
    { week_start: '2026-08-10', total_volume_kg: 28500, session_count: 3 },
    { week_start: '2026-08-17', total_volume_kg: 22500, session_count: 2 },
  ],
};

export const mockWarmupTemplates = [
  {
    id: 'wt-1',
    user_id: 'user-1',
    name: 'Squat Warmup',
    exercise_name: 'Squat',
    steps: [
      { id: 'ws-1', warmup_template_id: 'wt-1', step_number: 1, weight_kg: 40, reps: 10, notes: 'Empty bar' },
      { id: 'ws-2', warmup_template_id: 'wt-1', step_number: 2, weight_kg: 60, reps: 8 },
      { id: 'ws-3', warmup_template_id: 'wt-1', step_number: 3, weight_kg: 80, reps: 5 },
      { id: 'ws-4', warmup_template_id: 'wt-1', step_number: 4, weight_kg: 100, reps: 3 },
    ],
    created_at: '2026-07-01T10:00:00Z',
    updated_at: '2026-07-01T10:00:00Z',
  },
];

// ─── Cycling ─────────────────────────────────────────────────────────────────

export const mockCyclingProfile = {
  id: 'cp-1',
  user_id: 'user-1',
  ftp_watts: 260,
  weight_kg: 78,
  lactate_threshold_hr: 172,
  auto_estimate_ftp: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
};

export const mockCyclingMetrics = {
  recent_tss: 420,
  recent_distance_km: 185,
  recent_time_hours: 8.5,
  recent_elevation_m: 1200,
  recent_rides: 6,
  avg_intensity_factor: 0.78,
  avg_variability_index: 1.05,
  best_20min_power: 285,
  estimated_ftp: 271,
  ftp_watts: 260,
  weight_kg: 78,
  power_to_weight: 3.33,
  tss_trend: { current_value: 420, baseline_value: 380, direction: 'up' as const },
  distance_trend: { current_value: 185, baseline_value: 170, direction: 'up' as const },
  time_trend: { current_value: 8.5, baseline_value: 7.8, direction: 'up' as const },
  elevation_trend: { current_value: 1200, baseline_value: 1100, direction: 'stable' as const },
  rides_trend: { current_value: 6, baseline_value: 5, direction: 'up' as const },
  if_trend: { current_value: 0.78, baseline_value: 0.76, direction: 'stable' as const },
  vi_trend: { current_value: 1.05, baseline_value: 1.06, direction: 'stable' as const },
  ftp_wkg_benchmark: { label: 'Trained', range: '3.0–4.0', raw_label: 'trained' },
  ctl_benchmark: { label: 'Moderate', range: '50–80', raw_label: 'moderate' },
  vi_benchmark: { label: 'Good', range: '1.00–1.05', raw_label: 'good' },
};

export const mockTrainingLoad = {
  data: Array.from({ length: 90 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (89 - i));
    return {
      date: date.toISOString().split('T')[0],
      tss: Math.round(30 + Math.random() * 70),
      ctl: 55 + i * 0.12,
      atl: 50 + Math.sin(i / 7) * 15 + i * 0.05,
      tsb: 5 + Math.sin(i / 7) * 15,
    };
  }),
  current_ctl: 65,
  current_atl: 72,
  current_tsb: -7,
};

export const mockPowerCurve = {
  data: [
    { duration_label: '5s', duration_seconds: 5, best_power_watts: 950, date_achieved: '2026-08-10' },
    { duration_label: '1min', duration_seconds: 60, best_power_watts: 420, date_achieved: '2026-08-10' },
    { duration_label: '5min', duration_seconds: 300, best_power_watts: 310, date_achieved: '2026-08-15' },
    { duration_label: '20min', duration_seconds: 1200, best_power_watts: 285, date_achieved: '2026-08-12' },
    { duration_label: '60min', duration_seconds: 3600, best_power_watts: 255, date_achieved: '2026-08-10' },
  ],
  ftp_watts: 260,
};

export const mockPowerZones = {
  ftp_watts: 260,
  zones: [
    { zone: 'Z1', zone_name: 'Active Recovery', lower_bound_watts: 0, upper_bound_watts: 143, time_seconds: 3600, percentage: 25 },
    { zone: 'Z2', zone_name: 'Endurance', lower_bound_watts: 143, upper_bound_watts: 195, time_seconds: 5400, percentage: 37.5 },
    { zone: 'Z3', zone_name: 'Tempo', lower_bound_watts: 195, upper_bound_watts: 234, time_seconds: 2700, percentage: 18.75 },
    { zone: 'Z4', zone_name: 'Threshold', lower_bound_watts: 234, upper_bound_watts: 273, time_seconds: 1800, percentage: 12.5 },
    { zone: 'Z5', zone_name: 'VO2max', lower_bound_watts: 273, upper_bound_watts: 312, time_seconds: 720, percentage: 5 },
    { zone: 'Z6', zone_name: 'Anaerobic', lower_bound_watts: 312, upper_bound_watts: 390, time_seconds: 180, percentage: 1.25 },
  ],
  total_time_seconds: 14400,
};

export const mockVo2max = {
  vo2max: 52.5,
  confidence: 0.82,
  method: 'ACSM power-based',
  classification: 'Good',
  all_estimates: [
    { vo2max: 52.5, confidence: 0.82, method: 'ACSM power-based' },
    { vo2max: 51.2, confidence: 0.65, method: 'Uth HR-based' },
  ],
};

export const mockVo2maxHistory = {
  data: [
    { date: '2026-05-01', vo2max: 48.5, method: 'ACSM' },
    { date: '2026-06-01', vo2max: 50.2, method: 'ACSM' },
    { date: '2026-07-01', vo2max: 51.8, method: 'ACSM' },
    { date: '2026-08-01', vo2max: 52.5, method: 'ACSM' },
  ],
  current_vo2max: 52.5,
  current_classification: 'Good',
};

export const mockDecouplingHistory = {
  data: [
    { date: '2026-08-10', activity_id: 'act-1', decoupling_pct: 3.2, first_half_ratio: 1.82, second_half_ratio: 1.76, classification: 'Excellent', duration_seconds: 5400 },
    { date: '2026-08-05', activity_id: 'act-2', decoupling_pct: 4.8, first_half_ratio: 1.78, second_half_ratio: 1.70, classification: 'Acceptable', duration_seconds: 7200 },
  ],
  avg_decoupling_pct: 4.0,
  classification: 'Good',
};

export const mockFtpHistory = [
  { id: 'ftp-1', user_id: 'user-1', ftp_watts: 240, effective_date: '2026-03-01', source: 'test', created_at: '2026-03-01T00:00:00Z' },
  { id: 'ftp-2', user_id: 'user-1', ftp_watts: 250, effective_date: '2026-05-01', source: 'test', created_at: '2026-05-01T00:00:00Z' },
  { id: 'ftp-3', user_id: 'user-1', ftp_watts: 260, effective_date: '2026-07-01', source: 'estimate', created_at: '2026-07-01T00:00:00Z' },
];

export const mockLifetimePBs = {
  pbs: [
    { duration_label: '5s', duration_seconds: 5, best_power_watts: 950, pct_ftp: 365 },
    { duration_label: '1min', duration_seconds: 60, best_power_watts: 420, pct_ftp: 162 },
    { duration_label: '5min', duration_seconds: 300, best_power_watts: 310, pct_ftp: 119 },
    { duration_label: '20min', duration_seconds: 1200, best_power_watts: 285, pct_ftp: 110 },
    { duration_label: '60min', duration_seconds: 3600, best_power_watts: 255, pct_ftp: 98 },
  ],
  ftp_watts: 260,
  weight_kg: 78,
};

// ─── Routes ──────────────────────────────────────────────────────────────────

export const mockRoutes = [
  {
    id: 'route-1',
    name: 'Surrey Hills Loop',
    sport_type: 'cycling',
    distance_meters: 65000,
    elevation_gain_meters: 950,
    estimated_time_seconds: 9000,
    start_lat: 51.2362,
    start_lng: -0.5601,
    end_lat: 51.2362,
    end_lng: -0.5601,
    country: 'United Kingdom',
    locality: 'Surrey',
    is_loop: true,
    sources: [{ id: 'rs-1', provider: 'strava', provider_route_id: 'strava-route-1', provider_name: 'Surrey Hills Loop', synced_at: '2026-08-01T00:00:00Z' }],
    surface_profile: { road: 85, gravel: 10, trail: 5 },
    ride_count: 12,
    is_ridden: true,
    last_ridden_date: '2026-08-20',
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-08-20T00:00:00Z',
  },
  {
    id: 'route-2',
    name: 'Richmond Park Circuit',
    sport_type: 'cycling',
    distance_meters: 18000,
    elevation_gain_meters: 180,
    estimated_time_seconds: 2400,
    start_lat: 51.4435,
    start_lng: -0.2735,
    end_lat: 51.4435,
    end_lng: -0.2735,
    country: 'United Kingdom',
    locality: 'London',
    is_loop: true,
    sources: [{ id: 'rs-2', provider: 'strava', provider_route_id: 'strava-route-2', provider_name: 'Richmond Park', synced_at: '2026-08-01T00:00:00Z' }],
    ride_count: 25,
    is_ridden: true,
    last_ridden_date: '2026-08-18',
    created_at: '2026-02-15T00:00:00Z',
    updated_at: '2026-08-18T00:00:00Z',
  },
  {
    id: 'route-3',
    name: 'Box Hill Climb',
    sport_type: 'cycling',
    distance_meters: 5000,
    elevation_gain_meters: 250,
    estimated_time_seconds: 900,
    start_lat: 51.2456,
    start_lng: -0.3115,
    end_lat: 51.2501,
    end_lng: -0.3045,
    country: 'United Kingdom',
    locality: 'Surrey',
    is_loop: false,
    sources: [{ id: 'rs-3', provider: 'komoot', provider_route_id: 'kmt-route-1', provider_name: 'Box Hill', synced_at: '2026-07-15T00:00:00Z' }],
    ride_count: 8,
    is_ridden: true,
    last_ridden_date: '2026-08-10',
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-08-10T00:00:00Z',
  },
  {
    id: 'route-4',
    name: 'South Downs Way',
    sport_type: 'hiking',
    distance_meters: 160000,
    elevation_gain_meters: 3800,
    estimated_time_seconds: 43200,
    start_lat: 50.7825,
    start_lng: -0.6415,
    end_lat: 51.0575,
    end_lng: 0.2615,
    country: 'United Kingdom',
    locality: 'South Downs',
    is_loop: false,
    sources: [{ id: 'rs-4', provider: 'komoot', provider_route_id: 'kmt-route-2', provider_name: 'South Downs Way', synced_at: '2026-06-01T00:00:00Z' }],
    ride_count: 0,
    is_ridden: false,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
  },
];

export const mockRouteDetail = {
  ...mockRoutes[0],
  encoded_polyline: 'encoded_polyline_data_here',
  elevation_profile: { elevations: [100, 120, 150, 200, 250, 300, 280, 220, 180, 140, 100] },
};

// ─── Goals ───────────────────────────────────────────────────────────────────

export const mockGoals = [
  {
    id: 'goal-1',
    user_id: 'user-1',
    goal_type: 'ftp',
    target_value: 280,
    current_value: 260,
    target_date: '2026-12-31',
    status: 'active' as const,
    notes: 'Reach 280W FTP by end of year',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
  },
  {
    id: 'goal-2',
    user_id: 'user-1',
    goal_type: 'squat_1rm',
    target_value: 200,
    current_value: 180,
    target_date: '2026-12-31',
    status: 'active' as const,
    notes: '200kg squat',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-07-20T00:00:00Z',
  },
  {
    id: 'goal-3',
    user_id: 'user-1',
    goal_type: 'weekly_sessions',
    target_value: 6,
    current_value: 5,
    status: 'active' as const,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-08-20T00:00:00Z',
  },
];

// ─── Events ──────────────────────────────────────────────────────────────────

export const mockEvents = [
  {
    id: 'event-1',
    user_id: 'user-1',
    name: 'Surrey Hills Sportive',
    event_date: '2026-09-15',
    event_type: 'race' as const,
    target_tss: 300,
    taper_days: 14,
    notes: '100km sportive',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    days_until: 26,
    taper_start_date: '2026-09-01',
    days_until_taper: 12,
    is_in_taper: false,
  },
  {
    id: 'event-2',
    user_id: 'user-1',
    name: 'Local Lifting Meet',
    event_date: '2026-10-20',
    event_type: 'lift' as const,
    taper_days: 7,
    notes: '',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    days_until: 61,
    is_in_taper: false,
  },
];

// ─── Training Plans ──────────────────────────────────────────────────────────

export const mockTrainingPlanSummaries = [
  {
    id: 'plan-1',
    name: 'Base Building Block',
    start_date: '2026-08-01',
    end_date: '2026-09-12',
    plan_type: 'base',
    status: 'active',
    day_count: 42,
    completed_days: 18,
  },
  {
    id: 'plan-2',
    name: 'Pre-Season Build',
    start_date: '2026-06-01',
    end_date: '2026-07-12',
    plan_type: 'build',
    status: 'completed',
    day_count: 42,
    completed_days: 42,
  },
];

export const mockTrainingPlan = {
  id: 'plan-1',
  user_id: 'user-1',
  name: 'Base Building Block',
  description: 'Aerobic base building phase',
  start_date: '2026-08-01',
  end_date: '2026-09-12',
  plan_type: 'base' as const,
  status: 'active' as const,
  created_at: '2026-07-25T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
  days: Array.from({ length: 42 }, (_, i) => {
    const date = new Date('2026-08-01');
    date.setDate(date.getDate() + i);
    const types = ['rest', 'easy', 'moderate', 'hard', 'easy', 'moderate', 'rest'] as const;
    return {
      id: `day-${i}`,
      plan_id: 'plan-1',
      day_date: date.toISOString().split('T')[0],
      planned_tss: types[i % 7] === 'rest' ? 0 : 40 + Math.round(Math.random() * 60),
      planned_duration_min: types[i % 7] === 'rest' ? 0 : 30 + Math.round(Math.random() * 60),
      planned_type: types[i % 7],
      notes: '',
      completed: i < 18,
      created_at: '2026-07-25T00:00:00Z',
    };
  }),
};

// ─── Calendar ────────────────────────────────────────────────────────────────

export const mockCalendarData = {
  activities: [
    { id: 'cal-act-1', date: '2026-08-02', sport_type: 'cycling', name: 'Ride 2', duration_seconds: 3600, distance_meters: 35000, tss: 65 },
    { id: 'cal-act-2', date: '2026-08-04', sport_type: 'weighttraining', name: 'Lifting Session', duration_seconds: 3600, tss: 65, focus: 'Squat' },
    { id: 'cal-act-3', date: '2026-08-06', sport_type: 'cycling', name: 'Ride 6', duration_seconds: 3600, distance_meters: 35000, tss: 65 },
    { id: 'cal-act-4', date: '2026-08-08', sport_type: 'cycling', name: 'Ride 8', duration_seconds: 3600, distance_meters: 35000, tss: 65 },
    { id: 'cal-act-5', date: '2026-08-10', sport_type: 'weighttraining', name: 'Lifting Session', duration_seconds: 3600, tss: 65, focus: 'Squat' },
    { id: 'cal-act-6', date: '2026-08-12', sport_type: 'cycling', name: 'Ride 12', duration_seconds: 3600, distance_meters: 35000, tss: 65 },
    { id: 'cal-act-7', date: '2026-08-14', sport_type: 'cycling', name: 'Ride 14', duration_seconds: 3600, distance_meters: 35000, tss: 65 },
    { id: 'cal-act-8', date: '2026-08-16', sport_type: 'weighttraining', name: 'Lifting Session', duration_seconds: 3600, tss: 65, focus: 'Squat' },
    { id: 'cal-act-9', date: '2026-08-18', sport_type: 'cycling', name: 'Ride 18', duration_seconds: 3600, distance_meters: 35000, tss: 65 },
    { id: 'cal-act-10', date: '2026-08-20', sport_type: 'cycling', name: 'Ride 20', duration_seconds: 3600, distance_meters: 35000, tss: 65 },
    { id: 'cal-act-11', date: '2026-08-22', sport_type: 'weighttraining', name: 'Lifting Session', duration_seconds: 3600, tss: 65, focus: 'Squat' },
    { id: 'cal-act-12', date: '2026-08-24', sport_type: 'cycling', name: 'Ride 24', duration_seconds: 3600, distance_meters: 35000, tss: 65 },
    { id: 'cal-act-13', date: '2026-08-26', sport_type: 'cycling', name: 'Ride 26', duration_seconds: 3600, distance_meters: 35000, tss: 65 },
    { id: 'cal-act-14', date: '2026-08-28', sport_type: 'weighttraining', name: 'Lifting Session', duration_seconds: 3600, tss: 65, focus: 'Squat' },
  ],
  daily_metrics: [
    { date: '2026-08-01', recovery_score: 72, hrv_ms: 52 },
    { date: '2026-08-02', recovery_score: 68, hrv_ms: 48 },
    { date: '2026-08-03', recovery_score: 75, hrv_ms: 55 },
    { date: '2026-08-04', recovery_score: 70, hrv_ms: 50 },
    { date: '2026-08-05', recovery_score: 65, hrv_ms: 45 },
    { date: '2026-08-06', recovery_score: 78, hrv_ms: 58 },
    { date: '2026-08-07', recovery_score: 72, hrv_ms: 52 },
    { date: '2026-08-08', recovery_score: 68, hrv_ms: 48 },
    { date: '2026-08-09', recovery_score: 80, hrv_ms: 60 },
    { date: '2026-08-10', recovery_score: 74, hrv_ms: 54 },
    { date: '2026-08-11', recovery_score: 70, hrv_ms: 50 },
    { date: '2026-08-12', recovery_score: 66, hrv_ms: 46 },
    { date: '2026-08-13', recovery_score: 72, hrv_ms: 52 },
    { date: '2026-08-14', recovery_score: 76, hrv_ms: 56 },
    { date: '2026-08-15', recovery_score: 68, hrv_ms: 48 },
    { date: '2026-08-16', recovery_score: 82, hrv_ms: 62 },
    { date: '2026-08-17', recovery_score: 74, hrv_ms: 54 },
    { date: '2026-08-18', recovery_score: 70, hrv_ms: 50 },
    { date: '2026-08-19', recovery_score: 66, hrv_ms: 46 },
    { date: '2026-08-20', recovery_score: 72, hrv_ms: 52 },
    { date: '2026-08-21', recovery_score: 78, hrv_ms: 58 },
    { date: '2026-08-22', recovery_score: 70, hrv_ms: 50 },
    { date: '2026-08-23', recovery_score: 84, hrv_ms: 64 },
    { date: '2026-08-24', recovery_score: 76, hrv_ms: 56 },
    { date: '2026-08-25', recovery_score: 72, hrv_ms: 52 },
    { date: '2026-08-26', recovery_score: 68, hrv_ms: 48 },
    { date: '2026-08-27', recovery_score: 74, hrv_ms: 54 },
    { date: '2026-08-28', recovery_score: 80, hrv_ms: 60 },
  ],
};

// ─── Health / Readiness ──────────────────────────────────────────────────────

export const mockReadiness = {
  recovery_score: 72,
  readiness: 'green' as const,
  hrv_ms: 55,
  resting_hr: 52,
  message: 'Good recovery — ready for moderate to hard training',
  date: new Date().toISOString().split('T')[0],
};

export const mockRespiratoryRate = {
  current_rr: 15.2,
  recent_avg_rr: 15.5,
  baseline_avg_rr: 15.0,
  trend: 'stable' as const,
  date: new Date().toISOString().split('T')[0],
};

export const mockWhoopWeekly = {
  week_start: '2026-08-17',
  week_end: '2026-08-23',
  avg_recovery: 68,
  avg_recovery_trend: 'up' as const,
  total_strain: 85.5,
  total_strain_trend: 'stable' as const,
  avg_sleep_hours: 7.2,
  avg_sleep_trend: 'stable' as const,
  sleep_consistency: 82,
  best_recovery_day: { date: '2026-08-19', score: 85 },
  worst_recovery_day: { date: '2026-08-17', score: 55 },
  days_with_data: 5,
};

export const mockHealthAlerts = [
  {
    id: 'alert-1',
    alert_type: 'hrv_decline',
    severity: 'warning' as const,
    title: 'HRV Declining',
    description: 'Your HRV has dropped 15% over the past 7 days.',
    detected_date: '2026-08-19',
    status: 'active',
  },
];

// ─── Connections ─────────────────────────────────────────────────────────────

export const mockConnections = [
  {
    id: 'conn-1',
    provider: 'strava',
    provider_user_id: 'strava-user-123',
    created_at: '2026-01-15T00:00:00Z',
  },
];

// ─── Charts (generic) ───────────────────────────────────────────────────────

export const mockChartData = {
  chart_type: 'line' as const,
  title: 'Weekly TSS',
  labels: ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'W10', 'W11', 'W12'],
  series: [
    {
      name: 'TSS',
      data: [320, 380, 420, 350, 400, 450, 380, 420, 460, 400, 440, 420],
      color: '#3b82f6',
    },
  ],
  x_label: 'Week',
  y_label: 'TSS',
};

export const mockPeriodizationChart = {
  chart_type: 'area' as const,
  title: 'Periodization',
  labels: Array.from({ length: 16 }, (_, i) => `W${i + 1}`),
  series: [
    {
      name: 'CTL',
      data: [50, 52, 55, 58, 60, 62, 58, 60, 63, 65, 68, 70, 65, 67, 70, 72],
      color: '#3b82f6',
    },
    {
      name: 'ATL',
      data: [45, 55, 60, 50, 65, 70, 40, 55, 65, 72, 75, 60, 50, 60, 70, 72],
      color: '#ef4444',
    },
  ],
};

// ─── Per-Chart Mock Data ────────────────────────────────────────────────────

export const mockTrainingLoadChart = {
  chart_type: 'area' as const,
  title: 'Training Load',
  labels: Array.from({ length: 12 }, (_, i) => `W${i + 1}`),
  series: [
    { name: 'CTL', data: [50, 52, 55, 58, 60, 62, 58, 60, 63, 65, 68, 70], color: '#3b82f6' },
    { name: 'ATL', data: [45, 55, 60, 50, 65, 70, 40, 55, 65, 72, 75, 60], color: '#ef4444' },
    { name: 'TSB', data: [5, -3, -5, 8, -5, -8, 18, 5, -2, -7, -7, 10], color: '#22c55e' },
  ],
  x_label: 'Week',
  y_label: 'TSS',
};

export const mockPowerCurveChart = {
  chart_type: 'line' as const,
  title: 'Power Curve',
  labels: ['5s', '10s', '30s', '1min', '2min', '5min', '10min', '20min', '30min', '60min'],
  series: [
    { name: 'Best Power', data: [950, 800, 550, 420, 360, 310, 295, 285, 270, 255], color: '#3b82f6' },
  ],
  x_label: 'Duration',
  y_label: 'Watts',
};

export const mockPowerZonesChart = {
  chart_type: 'bar' as const,
  title: 'Power Zones',
  labels: ['Z1', 'Z2', 'Z3', 'Z4', 'Z5', 'Z6'],
  series: [
    { name: 'Time', data: [25, 37.5, 18.75, 12.5, 5, 1.25], color: '#3b82f6' },
  ],
  x_label: 'Zone',
  y_label: '% Time',
};

export const mockDailyTssChart = {
  chart_type: 'bar' as const,
  title: 'Daily TSS',
  labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  series: [
    { name: 'TSS', data: [65, 0, 85, 45, 0, 95, 55], color: '#3b82f6' },
  ],
  x_label: 'Day',
  y_label: 'TSS',
};

export const mockFtpHistoryChart = {
  chart_type: 'line' as const,
  title: 'FTP History',
  labels: ['Mar', 'May', 'Jul'],
  series: [
    { name: 'FTP', data: [240, 250, 260], color: '#3b82f6' },
  ],
  x_label: 'Date',
  y_label: 'Watts',
};

export const mockHrZoneChart = {
  chart_type: 'bar' as const,
  title: 'Heart Rate Zones',
  labels: ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'],
  series: [
    { name: 'Time', data: [15, 35, 30, 15, 5], color: '#ef4444' },
  ],
  x_label: 'Zone',
  y_label: '% Time',
};

export const mockVo2maxTrendChart = {
  chart_type: 'line' as const,
  title: 'VO2max Trend',
  labels: ['May', 'Jun', 'Jul', 'Aug'],
  series: [
    { name: 'VO2max', data: [48.5, 50.2, 51.8, 52.5], color: '#22c55e' },
  ],
  x_label: 'Date',
  y_label: 'ml/kg/min',
};

export const mockDecouplingTrendChart = {
  chart_type: 'line' as const,
  title: 'Decoupling Trend',
  labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4'],
  series: [
    { name: 'Decoupling %', data: [5.2, 4.8, 4.0, 3.2], color: '#f59e0b' },
  ],
  x_label: 'Week',
  y_label: '%',
};

export const mockWeightTrendChart = {
  chart_type: 'line' as const,
  title: 'Weight Trend',
  labels: ['Aug 1', 'Aug 5', 'Aug 10', 'Aug 15', 'Aug 20'],
  series: [
    { name: 'Weight', data: [78.5, 78.2, 78.0, 77.8, 78.0], color: '#8b5cf6' },
  ],
  x_label: 'Date',
  y_label: 'kg',
};

export const mockWeeklyTssChart = {
  chart_type: 'bar' as const,
  title: 'Weekly TSS',
  labels: ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'W10', 'W11', 'W12'],
  series: [
    { name: 'TSS', data: [320, 380, 420, 350, 400, 450, 380, 420, 460, 400, 440, 420], color: '#3b82f6' },
  ],
  x_label: 'Week',
  y_label: 'TSS',
};

export const mockStrainVsRecoveryChart = {
  chart_type: 'scatter' as const,
  title: 'Strain vs Recovery',
  labels: ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5', 'Day 6', 'Day 7'],
  series: [
    { name: 'Strain vs Recovery', data: [12.5, 14.2, 8.3, 15.1, 10.5, 11.8, 9.2], color: '#f59e0b' },
  ],
  x_label: 'Strain',
  y_label: 'Recovery',
};

// ─── LLM Analysis ────────────────────────────────────────────────────────────

export const mockLlmAnalysis = {
  id: 'llm-1',
  analysis_date: '2026-08-18',
  stats_json: { weekly_tss: 420, ctl: 65, tsb: -7 },
  analysis_text: 'Your training load is well-balanced this week. CTL is steadily increasing while TSB remains in a productive range. Consider adding one more endurance ride to build your aerobic base further.',
  model_used: 'gemini-2.0-flash',
  created_at: '2026-08-18T05:00:00Z',
};

// ─── Exercise Suggestions ────────────────────────────────────────────────────

export const mockExerciseSuggestions = [
  { name: 'Squat', category: 'big3' },
  { name: 'Bench Press', category: 'big3' },
  { name: 'Deadlift', category: 'big3' },
  { name: 'Overhead Press', category: 'compound' },
  { name: 'Barbell Row', category: 'compound' },
  { name: 'Romanian Deadlift', category: 'compound' },
  { name: 'Pull-ups', category: 'compound' },
  { name: 'Leg Press', category: 'accessory' },
  { name: 'Dumbbell Curl', category: 'accessory' },
];

// ─── Weight History ──────────────────────────────────────────────────────────

export const mockWeightHistory = {
  entries: [
    { date: '2026-08-01', weight_kg: 78.5, source: 'manual' },
    { date: '2026-08-05', weight_kg: 78.2, source: 'manual' },
    { date: '2026-08-10', weight_kg: 78.0, source: 'manual' },
    { date: '2026-08-15', weight_kg: 77.8, source: 'manual' },
    { date: '2026-08-20', weight_kg: 78.0, source: 'manual' },
  ],
  rolling_avg: [
    { date: '2026-08-01', weight_kg: 78.5 },
    { date: '2026-08-05', weight_kg: 78.35 },
    { date: '2026-08-10', weight_kg: 78.23 },
    { date: '2026-08-15', weight_kg: 78.13 },
    { date: '2026-08-20', weight_kg: 78.1 },
  ],
};

// ─── FTP Estimate ────────────────────────────────────────────────────────────

export const mockFtpEstimate = {
  estimated_ftp: 271,
  confidence: 0.85,
  method: '20-minute power × 0.95',
  source_duration: 1200,
  all_estimates: [
    { ftp: 271, confidence: 0.85, source_duration: 1200, method: '20min' },
    { ftp: 265, confidence: 0.7, source_duration: 3600, method: '60min' },
  ],
  best_power_available: { '20min': 285, '60min': 255 },
  days_analyzed: 90,
  accepted: false,
  previous_ftp: 260,
};
