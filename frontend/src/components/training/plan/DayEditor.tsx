'use client';

/**
 * DayEditor — the single editing surface for one plan day.
 *
 * Extracted from WeeklyView's `ExpandedPanel` and merged with PlanBuilder's
 * day editor, so Plan mode renders the same editor wherever a day appears (the
 * "one editor" model). Every field commits through `useInstantDayEdit` — an
 * optimistic, targeted day PATCH — so there is no draft and no Save button.
 * Text fields commit on blur; selects/numbers commit on change.
 *
 * Rendered inline below the week strip (desktop and mobile); the bottom-sheet
 * refinement is the mobile pass.
 */

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Target, Upload, ClipboardList } from 'lucide-react';

import type {
  Goal,
  PlannedExercise,
  PlanSport,
  TrainingWeekDay,
  UpdateTrainingPlanDayPayload,
} from '@/lib/api';
import {
  useAuthFetch,
  getWarmupTemplates,
  getLiftingSessions,
  copySessionToPlanDay,
  suggestLoad,
  previewWorkout,
} from '@/lib/api';
import { getActiveLocale } from '@/lib/utils';
import { useInstantDayEdit } from '@/lib/training/useInstantDayEdit';
import { computedVolumeKg } from '@/lib/training/planDayHelpers';
import { goalProgressPct } from '@/components/ui/GoalCard';
import { goalsForPlanDay, goalShortLabel } from '@/components/goals/goalPlanLinks';
import { useAutoregulationMap } from '@/components/lifting/AutoregulationCard';
import { ExerciseAutocomplete } from '@/components/ui/ExerciseAutocomplete';
import { DayConformityPanel } from '../DayConformityPanel';
import { DAY_TYPES, FOCUS_OPTIONS } from '../dayCellShared';

const inputCls =
  'w-full px-2 py-1.5 bg-background border border-surface-light rounded-lg text-foreground text-sm focus:outline-none focus:border-accent';
const labelCls = 'block text-xs text-muted mb-1';

export interface DayEditorProps {
  planId: string;
  /** The visible week — so the optimistic patch hits the right cache entry. */
  week: number;
  day: TrainingWeekDay;
  /** Active goals (plan → goal cross-links). */
  goals: Goal[];
  onOpenRoutePicker: () => void;
  onOpenWahooPush: () => void;
}

export function DayEditor({
  planId,
  week,
  day,
  goals,
  onOpenRoutePicker,
  onOpenWahooPush,
}: DayEditorProps) {
  const { authFetch, token } = useAuthFetch();
  const edit = useInstantDayEdit(planId, week);
  const autoMap = useAutoregulationMap();

  const isRest = day.sport === 'rest';
  const isStrength = day.sport === 'strength';
  const volume = computedVolumeKg(day.planned_exercises);

  const patch = (payload: UpdateTrainingPlanDayPayload) =>
    edit.mutate({ dayId: day.id, payload });

  // Text fields are local and commit on blur (one PATCH per edit, not keystroke).
  const [desc, setDesc] = useState(day.workout_description ?? '');
  const [notes, setNotes] = useState(day.notes ?? '');
  useEffect(() => {
    setDesc(day.workout_description ?? '');
    setNotes(day.notes ?? '');
  }, [day.id, day.workout_description, day.notes]);

  // Cycle targets preview (computed from type + duration + current FTP). Shown,
  // not auto-applied — the user taps "Use these targets" (avoids a patch effect).
  const previewQuery = useQuery({
    queryKey: ['workout-preview', day.planned_type, day.planned_duration_min],
    queryFn: () => previewWorkout(authFetch, day.planned_type, day.planned_duration_min ?? 0),
    enabled:
      day.sport === 'cycle' &&
      day.planned_type !== 'rest' &&
      !!day.planned_duration_min &&
      !!token,
    staleTime: 5 * 60_000,
  });
  const targets = previewQuery.data?.targets ?? null;

  const { data: warmupTemplates } = useQuery({
    queryKey: ['warmup-templates'],
    queryFn: () => getWarmupTemplates(authFetch),
    enabled: isStrength && !!token,
    staleTime: 5 * 60_000,
  });
  const { data: liftingSessions } = useQuery({
    queryKey: ['lifting-sessions'],
    queryFn: () => getLiftingSessions(authFetch),
    enabled: isStrength && !!token,
    staleTime: 60_000,
  });
  const selectedWarmup = warmupTemplates?.find((wt) => wt.id === day.warmup_template_id);

  const [showSessionPicker, setShowSessionPicker] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [suggestIdx, setSuggestIdx] = useState<number | null>(null);
  const [suggestMsg, setSuggestMsg] = useState<string | null>(null);

  const dayGoals = useMemo(() => goalsForPlanDay(goals, day), [goals, day]);

  // ── Strength exercise editing ──────────────────────────────────────────
  const patchExercise = (idx: number, patchEx: Partial<PlannedExercise>) => {
    const list = [...(day.planned_exercises ?? [])];
    list[idx] = { ...list[idx], ...patchEx };
    patch({ planned_exercises: list });
  };
  const removeExercise = (idx: number) => {
    const list = (day.planned_exercises ?? []).filter((_, i) => i !== idx);
    patch({ planned_exercises: list });
  };
  const addExercise = () => {
    const list = [
      ...(day.planned_exercises ?? []),
      { exercise: '', sets: 3, reps: 8, weight_kg: null, rpe: null },
    ];
    patch({ planned_exercises: list });
  };

  // FL3 — suggest a working weight as % of the current e1RM.
  const handleSuggestLoad = async (idx: number) => {
    const ex = day.planned_exercises?.[idx];
    if (!ex || !ex.exercise.trim()) {
      setSuggestMsg('Enter an exercise name first.');
      return;
    }
    const pct = ex.pct_1rm ?? 0.8;
    setSuggestIdx(idx);
    setSuggestMsg(null);
    try {
      const res = await suggestLoad(authFetch, {
        exercise_name: ex.exercise.trim(),
        sets: ex.sets || 3,
        reps: ex.reps || 8,
        pct_1rm: pct,
      });
      if (res.target_kg == null) {
        setSuggestMsg(`No PR or recent history for “${ex.exercise}” — enter weight manually.`);
      } else {
        patchExercise(idx, { weight_kg: res.target_kg, pct_1rm: res.pct_1rm });
        setSuggestMsg(
          `${ex.exercise}: ${res.target_kg}kg @ ${Math.round(res.pct_1rm * 100)}% ` +
            `(e1RM ${res.basis_1rm_kg}kg via ${res.basis_source === 'pr' ? 'PR' : 'recent sets'})` +
            (res.safety_warning ? ` — ${res.safety_warning}` : ''),
        );
      }
    } catch (err) {
      setSuggestMsg(err instanceof Error ? err.message : 'Suggestion failed.');
    } finally {
      setSuggestIdx(null);
    }
  };

  const handleCopySession = async () => {
    if (!selectedSessionId) return;
    try {
      await copySessionToPlanDay(authFetch, planId, day.id, selectedSessionId);
      setShowSessionPicker(false);
      setSelectedSessionId('');
    } catch (err) {
      setSuggestMsg(err instanceof Error ? err.message : 'Failed to copy session');
    }
  };

  return (
    <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
      {/* Sport / type / duration */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className={labelCls}>Sport</label>
          <select
            value={day.sport}
            onChange={(e) => {
              const sport = e.target.value as PlanSport;
              if (sport === 'rest') patch({ sport, planned_type: 'rest' });
              else if (sport === 'strength' && day.sport !== 'strength')
                patch({ sport, planned_focus: day.planned_focus ?? 'squat' });
              else patch({ sport });
            }}
            className={inputCls}
            aria-label="Sport"
          >
            <option value="rest">Rest</option>
            <option value="cycle">Cycle</option>
            <option value="strength">Strength</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Type</label>
          <select
            value={day.planned_type}
            disabled={isRest}
            onChange={(e) => patch({ planned_type: e.target.value })}
            className={`${inputCls} disabled:opacity-50`}
            aria-label="Type"
          >
            {DAY_TYPES.map((dt) => (
              <option key={dt} value={dt} className="capitalize">
                {dt}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Duration (min)</label>
          <input
            type="number"
            min={0}
            value={day.planned_duration_min ?? ''}
            onChange={(e) =>
              patch({ planned_duration_min: e.target.value === '' ? null : parseInt(e.target.value) })
            }
            className={inputCls}
            aria-label="Duration"
          />
        </div>
        {!isStrength && (
          <div>
            <label className={labelCls}>TSS</label>
            <input
              type="number"
              min={0}
              value={day.planned_tss ?? ''}
              onChange={(e) =>
                patch({ planned_tss: e.target.value === '' ? null : parseFloat(e.target.value) })
              }
              className={inputCls}
              aria-label="TSS"
            />
          </div>
        )}
      </div>

      {/* Cycle targets + route + Wahoo */}
      {day.sport === 'cycle' && (
        <div className="space-y-3">
          {targets ? (
            <div className="rounded-lg bg-surface-light/30 border border-surface-light/50 p-2 space-y-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted">
                <span>{targets.zone_name}</span>
                <span>{targets.target_power_low}–{targets.target_power_high}W</span>
                <span>{Math.round(targets.target_tss_low)}–{Math.round(targets.target_tss_high)} TSS</span>
                <span>IF {targets.target_if_low}–{targets.target_if_high}</span>
              </div>
              <button
                onClick={() =>
                  patch({
                    planned_power_watts: Math.round(
                      (targets.target_power_low + targets.target_power_high) / 2,
                    ),
                    planned_tss: Math.round((targets.target_tss_low + targets.target_tss_high) / 2),
                    planned_zone: targets.zone_name,
                  })
                }
                className="text-[10px] text-accent hover:text-accent/80"
              >
                Use these targets
              </button>
            </div>
          ) : (
            <p className="text-[11px] text-muted">
              {day.planned_duration_min ? 'Set FTP on Cycling to see computed targets' : 'Set duration to see targets'}
            </p>
          )}

          {/* Route */}
          <div className="space-y-1">
            <p className="text-[10px] font-medium text-muted uppercase tracking-wide">Route</p>
            {day.actual_activity?.route_id ? (
              <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-full bg-positive/15 text-positive border border-positive/30 truncate">
                {day.actual_activity.route_name || 'Linked route'}
              </span>
            ) : day.planned_route_id ? (
              <div className="flex items-center gap-2">
                <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-full bg-positive/15 text-positive border border-positive/30 truncate">
                  {day.route_matches?.find((m) => m.route_id === day.planned_route_id)?.name || 'Route assigned'}
                </span>
                <button onClick={onOpenRoutePicker} className="text-[10px] text-accent hover:text-accent/80 shrink-0">
                  Change
                </button>
                <button
                  onClick={() => patch({ planned_route_id: null })}
                  disabled={edit.isPending}
                  className="text-[10px] text-warning hover:text-warning/80 disabled:opacity-50 shrink-0"
                >
                  Remove
                </button>
              </div>
            ) : (
              <button onClick={onOpenRoutePicker} className="text-[10px] text-accent hover:text-accent/80">
                <MapPin className="w-3 h-3 mr-1" /> Pick a route...
              </button>
            )}
          </div>

          {/* Wahoo */}
          <div className="space-y-1">
            <p className="text-[10px] font-medium text-muted uppercase tracking-wide">Wahoo</p>
            {day.wahoo_pushed_at ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-full bg-accent/15 text-accent border border-accent/30">
                  Pushed {new Date(day.wahoo_pushed_at).toLocaleDateString(getActiveLocale())}
                  {day.wahoo_push_workout ? ' · workout' : ''}
                  {day.wahoo_route_id ? ' · route' : ''}
                </span>
                <button onClick={onOpenWahooPush} className="text-[10px] text-accent hover:text-accent/80 shrink-0">
                  Manage
                </button>
              </div>
            ) : (
              <button onClick={onOpenWahooPush} className="text-[10px] text-accent hover:text-accent/80">
                <Upload className="w-3 h-3 inline mr-1" /> Push to Wahoo
              </button>
            )}
          </div>
        </div>
      )}

      {/* Strength editing */}
      {isStrength && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className={labelCls}>Session Type</label>
              <select
                value={day.planned_focus ?? 'squat'}
                onChange={(e) => patch({ planned_focus: e.target.value })}
                className={inputCls}
                aria-label="Session type"
              >
                {FOCUS_OPTIONS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Target RPE</label>
              <input
                type="number"
                min={1}
                max={10}
                step={0.5}
                value={day.planned_rpe ?? ''}
                onChange={(e) =>
                  patch({ planned_rpe: e.target.value === '' ? null : parseFloat(e.target.value) })
                }
                className={inputCls}
                aria-label="Target RPE"
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Warmup Template</label>
              <select
                value={day.warmup_template_id ?? ''}
                onChange={(e) => patch({ warmup_template_id: e.target.value || null })}
                className={inputCls}
                aria-label="Warmup template"
              >
                <option value="">No warmup</option>
                {warmupTemplates?.map((wt) => (
                  <option key={wt.id} value={wt.id}>
                    {wt.name}
                    {wt.exercise_name ? ` (${wt.exercise_name})` : ''}
                  </option>
                ))}
              </select>
              {selectedWarmup && selectedWarmup.steps.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {selectedWarmup.steps.map((s) => (
                    <p key={s.step_number} className="text-[10px] text-muted">
                      {s.step_number}. {s.weight_kg}kg × {s.reps} reps
                      {s.notes ? ` — ${s.notes}` : ''}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Exercises */}
          <div className="space-y-2">
            <label className={labelCls}>
              Exercises
              {volume != null && (
                <span className="ml-2 normal-case text-muted">
                  Target volume ≈ {volume.toLocaleString()} kg
                </span>
              )}
            </label>
            {(day.planned_exercises ?? []).map((ex, idx) => (
              <div key={idx} className="grid grid-cols-6 sm:grid-cols-12 gap-1.5 items-center">
                <div className="col-span-6 sm:col-span-4">
                  <ExerciseAutocomplete
                    value={ex.exercise}
                    onChange={(v) => patchExercise(idx, { exercise: v })}
                    placeholder="Exercise"
                    className="w-full bg-background border border-surface-light text-foreground text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-accent"
                  />
                </div>
                <input
                  type="number"
                  min={1}
                  aria-label="Sets"
                  value={ex.sets}
                  onChange={(e) => patchExercise(idx, { sets: parseInt(e.target.value) || 1 })}
                  className="col-span-1 px-1.5 py-1.5 bg-background border border-surface-light rounded-lg text-foreground text-xs focus:outline-none focus:border-accent"
                />
                <input
                  type="number"
                  min={1}
                  aria-label="Reps"
                  value={ex.reps}
                  onChange={(e) => patchExercise(idx, { reps: parseInt(e.target.value) || 1 })}
                  className="col-span-1 px-1.5 py-1.5 bg-background border border-surface-light rounded-lg text-foreground text-xs focus:outline-none focus:border-accent"
                />
                <div className="col-span-2 flex items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    step={2.5}
                    aria-label="Weight kg"
                    placeholder="kg"
                    title={ex.pct_1rm != null ? `Basis: ${Math.round(ex.pct_1rm * 100)}% 1RM` : undefined}
                    value={ex.weight_kg ?? ''}
                    onChange={(e) =>
                      patchExercise(idx, {
                        weight_kg: e.target.value === '' ? null : parseFloat(e.target.value),
                      })
                    }
                    className="flex-1 min-w-0 px-1.5 py-1.5 bg-background border border-surface-light rounded-lg text-foreground text-xs focus:outline-none focus:border-accent"
                  />
                  <button
                    onClick={() => handleSuggestLoad(idx)}
                    disabled={suggestIdx !== null}
                    title={`Suggest weight from current e1RM @ ${Math.round((ex.pct_1rm ?? 0.8) * 100)}%`}
                    aria-label={`Suggest weight for ${ex.exercise || 'exercise'}`}
                    className="shrink-0 px-1.5 py-1.5 text-[10px] rounded-lg bg-surface-light/60 text-muted hover:text-foreground transition-colors disabled:opacity-50"
                  >
                    {suggestIdx === idx ? '…' : '%1RM'}
                  </button>
                  {(() => {
                    const hint = autoMap.get((ex.exercise ?? '').toLowerCase());
                    if (!hint || hint.suggestedWeightKg == null || hint.deltaKg === 0) return null;
                    return (
                      <span className="text-accent text-[10px] shrink-0" title={hint.reason}>
                        →{hint.suggestedWeightKg}
                      </span>
                    );
                  })()}
                </div>
                <input
                  type="number"
                  min={1}
                  max={10}
                  step={0.5}
                  aria-label="RPE"
                  placeholder="RPE"
                  value={ex.rpe ?? ''}
                  onChange={(e) =>
                    patchExercise(idx, { rpe: e.target.value === '' ? null : parseFloat(e.target.value) })
                  }
                  className="col-span-2 px-1.5 py-1.5 bg-background border border-surface-light rounded-lg text-foreground text-xs focus:outline-none focus:border-accent"
                />
                <button
                  onClick={() => removeExercise(idx)}
                  title="Remove exercise"
                  className="col-span-6 sm:col-span-2 text-xs text-muted hover:text-warning py-1"
                >
                  Remove
                </button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={addExercise} className="text-xs text-accent hover:text-accent/80 font-medium">
                + Add exercise
              </button>
              <button
                onClick={() => {
                  setShowSessionPicker((v) => !v);
                  setSuggestMsg(null);
                }}
                className="text-xs text-muted hover:text-foreground inline-flex items-center gap-1"
              >
                <ClipboardList className="w-3 h-3" /> Copy from session
              </button>
            </div>
            {showSessionPicker && (
              <div className="flex items-center gap-2">
                <select
                  value={selectedSessionId}
                  onChange={(e) => setSelectedSessionId(e.target.value)}
                  className={`${inputCls} flex-1`}
                  aria-label="Session to copy"
                >
                  <option value="">Select a session…</option>
                  {(liftingSessions ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.session_date} — {s.focus ?? 'No focus'} ({s.sets.length} sets)
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleCopySession}
                  disabled={!selectedSessionId}
                  className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:bg-accent/80 disabled:opacity-50"
                >
                  Copy
                </button>
              </div>
            )}
            {suggestMsg && <p className="text-[11px] text-muted">{suggestMsg}</p>}
          </div>
        </div>
      )}

      {/* Description + notes (commit on blur) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Workout Description</label>
          <textarea
            rows={2}
            maxLength={1000}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            onBlur={() => {
              if ((day.workout_description ?? '') !== desc)
                patch({ workout_description: desc || null });
            }}
            className={inputCls}
            aria-label="Workout description"
          />
        </div>
        <div>
          <label className={labelCls}>Notes</label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => {
              if ((day.notes ?? '') !== notes) patch({ notes: notes || null });
            }}
            className={inputCls}
            aria-label="Notes"
          />
        </div>
      </div>

      <label className="inline-flex items-center gap-2 text-sm text-muted cursor-pointer">
        <input
          type="checkbox"
          checked={day.completed}
          onChange={() => patch({ completed: !day.completed })}
          className="accent-green-500"
        />
        Completed
      </label>

      {/* Actual */}
      {(day.actual_activity || day.actual_lifting_session) && (
        <div className="rounded-lg bg-positive/10 border border-positive/20 px-2 py-1.5">
          {day.actual_activity ? (
            <Link
              href={`/activities?activity=${day.actual_activity.id}`}
              className="text-[11px] text-positive font-medium truncate"
            >
              {day.actual_activity.name} →
            </Link>
          ) : (
            <p className="text-[11px] text-positive font-medium">
              {day.actual_lifting_session!.focus
                ? day.actual_lifting_session!.focus!
                : 'Lifting'}{' '}
              · {Math.round(day.actual_lifting_session!.total_volume_kg ?? 0)}kg
            </p>
          )}
        </div>
      )}

      {/* Goals this day supports */}
      {dayGoals.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted uppercase tracking-wide">Supports goals</p>
          {dayGoals.map((g) => (
            <Link
              key={g.id}
              href="/goals"
              title={`View ${goalShortLabel(g)} in goals`}
              className="flex min-h-[44px] items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-surface-light/40 transition-colors"
            >
              <Target className="w-3 h-3 text-accent" aria-hidden="true" />
              <span className="text-xs text-foreground truncate">{goalShortLabel(g)}</span>
              <span className="text-xs text-muted tabular-nums shrink-0">{goalProgressPct(g).toFixed(0)}%</span>
              <span className="ml-auto text-accent text-xs shrink-0" aria-hidden="true">→</span>
            </Link>
          ))}
        </div>
      )}

      {/* Phase 5C — plan-vs-actual conformity scoring for this day. */}
      <DayConformityPanel planId={planId} day={day} />
    </div>
  );
}
