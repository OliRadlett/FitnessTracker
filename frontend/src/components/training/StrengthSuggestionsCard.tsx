import type { StrengthPlanSuggestionsResponse } from '@/lib/api/types';

interface StrengthSuggestionsCardProps {
  data: StrengthPlanSuggestionsResponse;
  onApplyDay: (dayId: string, exercises: any[]) => void;
}

export function StrengthSuggestionsCard({ data, onApplyDay }: StrengthSuggestionsCardProps) {
  if (!data.suggestions?.length) return null;

  return (
    <div className="p-3 bg-surface-light/30 rounded-lg border border-surface-light/50">
      <h4 className="text-sm font-semibold text-white mb-2">Smart Weight Suggestions</h4>
      <p className="text-xs text-muted mb-3">{data.summary}</p>

      {data.suggestions.map((daySuggestion) => {
        const exercisesPayload = daySuggestion.exercises.map((e) => ({
          exercise: e.exercise_name,
          weight_kg: e.suggested_weight_kg,
          sets: e.sets,
          reps: e.reps,
          rpe: e.rpe,
        }));

        return (
          <div
            key={daySuggestion.day_id}
            className="mb-3 last:mb-0 p-2 bg-surface/30 rounded border border-surface-light/30"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-white">
                {new Date(daySuggestion.day_date).toLocaleDateString('en-US', {
                  weekday: 'short', month: 'short', day: 'numeric'
                })}
                {daySuggestion.planned_focus && (
                  <span className="text-xs text-muted ml-2">({daySuggestion.planned_focus})</span>
                )}
              </span>
              <button
                onClick={() => onApplyDay(daySuggestion.day_id, exercisesPayload)}
                className="text-xs px-2 py-1 bg-accent/20 text-accent rounded hover:bg-accent/30 transition-colors"
              >
                Apply All
              </button>
            </div>

            <div className="space-y-1.5">
              {daySuggestion.exercises.map((ex, i) => (
                <div
                  key={`${daySuggestion.day_id}-${i}`}
                  className="flex items-center justify-between text-xs"
                >
                  <span className="text-muted">{ex.exercise_name}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-muted">{ex.old_weight_kg ?? 0}kg</span>
                    \u2192
                    <span className="text-positive font-medium">
                      {ex.suggested_weight_kg}kg
                    </span>
                    {ex.rpe != null && (
                      <span className="text-muted">RPE {ex.rpe.toFixed(1)} \u00b7 {ex.sets}x{ex.reps}</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
