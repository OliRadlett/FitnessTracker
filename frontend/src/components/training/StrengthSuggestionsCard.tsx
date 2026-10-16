'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuthFetch } from '@/lib/api/fetch';
import { getStrengthSuggestions, updatePlanDay } from '@/lib/api/trainingPlans';
import { mergeSuggestedWeights } from '@/lib/training/planDayHelpers';
import { useToast } from '@/components/ui/Toast';
import type { StrengthPlanSuggestionsResponse, TrainingPlan } from '@/lib/api/types';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

interface StrengthSuggestionsCardProps {
  planId: string;
}

export function StrengthSuggestionsCard({ planId }: StrengthSuggestionsCardProps) {
  const { authFetch, token } = useAuthFetch();
  const { success, error: toastError } = useToast();
  const [isApplying, setIsApplying] = useState(false);

  const {
    data: suggestions,
    isLoading,
    refetch,
  } = useQuery<StrengthPlanSuggestionsResponse>({
    queryKey: ['strength-suggestions', planId],
    queryFn: () => getStrengthSuggestions(authFetch, planId),
    enabled: !!planId,
    staleTime: 5 * 60 * 1000,
  });

  // The shell's plan entry, shared by key so a day edit elsewhere is visible
  // here. Applying a suggestion needs the day's full list, which only the plan
  // carries.
  const { data: plan } = useQuery<TrainingPlan>({
    queryKey: ['training-plan', planId],
    queryFn: () => authFetch<TrainingPlan>(`/api/v1/training-plans/${planId}`),
    enabled: !!planId && !!token,
  });

  if (isLoading) {
    return (
      <Card className="p-4">
        <p className="text-sm text-muted-foreground">Loading strength suggestions…</p>
      </Card>
    );
  }

  if (!suggestions || !suggestions.suggestions.length) {
    return null;
  }

  const handleApplyAll = async () => {
    if (!suggestions || !plan) return;
    setIsApplying(true);
    try {
      for (const day of suggestions.suggestions) {
        const planDay = plan.days.find((d) => d.id === day.day_id);
        // A day the plan does not carry has an unknown list; sending the
        // suggestions alone would delete whatever it holds.
        if (!planDay) continue;
        await updatePlanDay(authFetch, planId, day.day_id, {
          planned_exercises: mergeSuggestedWeights(
            planDay.planned_exercises,
            day.exercises,
          ),
        });
      }
      success('All weight suggestions applied!');
      refetch();
    } catch (err) {
      toastError('Failed to apply suggestions');
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <Card className="p-4 mb-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-sm">Smart Strength Suggestions</h3>
          {suggestions.summary && (
            <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
              {suggestions.summary}
            </p>
          )}
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={handleApplyAll}
          disabled={isApplying || !plan}
        >
          {isApplying ? 'Applying…' : 'Apply All'}
        </Button>
      </div>

      <div className="space-y-3">
        {suggestions.suggestions.map((day) => (
          <div key={day.day_id} className="border rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-medium text-muted-foreground">
                {new Date(day.day_date).toLocaleDateString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
              {day.planned_focus && (
                <span className="text-xs text-muted-foreground">
                  • {day.planned_focus}
                </span>
              )}
            </div>
            <div className="space-y-2">
              {day.exercises.map((ex) => (
                <div
                  key={ex.exercise_name}
                  className="flex items-center justify-between text-sm"
                >
                  <span>{ex.exercise_name}</span>
                  <div className="flex items-center gap-2">
                    {ex.rpe !== null && (
                      <span className="text-xs text-muted-foreground">
                        RPE {ex.rpe.toFixed(1)}
                      </span>
                    )}
                    <span className="text-xs">
                      {ex.old_weight_kg?.toFixed(1) ?? '?'} →{' '}
                      <strong>{ex.suggested_weight_kg.toFixed(1)} kg</strong>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
