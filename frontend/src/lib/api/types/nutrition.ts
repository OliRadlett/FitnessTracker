// ─── Nutrition / Ride Fueling ────────────────────────────────────────────────

export interface FuelScheduleEntry {
  time_min: number;
  carbs_g: number;
  hydration_ml: number;
  sodium_mg: number;
  suggestion?: string | null;
}

export interface RideFuelPlan {
  id: string;
  user_id: string;
  activity_id: string | null;
  planned_duration_min: number | null;
  planned_if: number | null;
  pre_ride_carbs_g: number;
  during_carbs_per_hour_g: number;
  during_hydration_ml_per_hour: number;
  during_sodium_mg_per_hour: number;
  post_ride_carbs_g: number;
  post_ride_protein_g: number;
  schedule: FuelScheduleEntry[];
  actual_pre_ride_notes: string | null;
  actual_during_notes: string | null;
  actual_post_ride_notes: string | null;
  actual_water_ml: number | null;
  actual_carbs_g: number | null;
  actual_electrolytes_mg: number | null;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface CreateFuelPlanPayload {
  activity_id?: string;
  planned_duration_min?: number;
  planned_if?: number;
}

export interface FuelActualsUpdatePayload {
  actual_water_ml?: number | null;
  actual_carbs_g?: number | null;
  actual_electrolytes_mg?: number | null;
}
