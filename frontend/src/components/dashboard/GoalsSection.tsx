'use client';

import React from 'react';
import type { Goal, CreateGoalPayload } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { GoalCard, GoalForm } from '@/components/ui/GoalCard';

interface GoalsSectionProps {
  goals: Goal[] | undefined;
  showGoalForm: boolean;
  setShowGoalForm: (show: boolean) => void;
  onCreateGoal: (payload: CreateGoalPayload) => void;
  isCreatingGoal: boolean;
  onAchieveGoal: (goalId: string) => void;
  onDeleteGoal: (goalId: string) => void;
}

export function GoalsSection({
  goals,
  showGoalForm,
  setShowGoalForm,
  onCreateGoal,
  isCreatingGoal,
  onAchieveGoal,
  onDeleteGoal,
}: GoalsSectionProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-muted uppercase tracking-wider">Training Goals</h2>
        <button
          onClick={() => setShowGoalForm(!showGoalForm)}
          className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors"
        >
          {showGoalForm ? 'Cancel' : '+ New Goal'}
        </button>
      </div>

      {showGoalForm && (
        <div className="mb-4">
          <GoalForm
            onSubmit={(data) => onCreateGoal(data)}
            onCancel={() => setShowGoalForm(false)}
            isPending={isCreatingGoal}
          />
        </div>
      )}

      {goals && goals.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {goals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              onAchieve={goal.status === 'active' && (goal.current_value ?? 0) >= goal.target_value
                ? () => onAchieveGoal(goal.id)
                : undefined}
              onDelete={() => onDeleteGoal(goal.id)}
            />
          ))}
        </div>
      ) : !showGoalForm ? (
        <Card>
          <div className="text-center py-6">
            <p className="text-3xl mb-2">🎯</p>
            <p className="text-muted text-sm">No goals set yet</p>
            <p className="text-muted text-xs mt-1">Set targets for FTP, 1RM, weekly sessions, or distance</p>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
