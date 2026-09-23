'use client';

// Correction loop: let the user fix the auto-detected / declared fields on a
// lift video (exercise, load, reps, camera angle, notes). Corrections apply
// to future reads; reprocess to re-run analysis with them.

import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { LiftVideo } from '@/lib/api';
import { useAuthFetch } from '@/lib/api';
import { updateLiftVideo } from '@/lib/api/lifting';
import { Modal, ModalHeader } from '@/components/ui/Modal';

const FIELD =
  'w-full bg-surface-light border border-surface-light text-foreground text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent';

export function VideoEditModal({
  video,
  open,
  onClose,
}: {
  video: LiftVideo;
  open: boolean;
  onClose: () => void;
}) {
  const { authFetch } = useAuthFetch();
  const queryClient = useQueryClient();
  const [exerciseName, setExerciseName] = useState(video.exercise_name ?? '');
  const [expectedReps, setExpectedReps] = useState(video.expected_reps?.toString() ?? '');
  const [repsCount, setRepsCount] = useState(video.reps_count?.toString() ?? '');
  const [weightKg, setWeightKg] = useState(video.weight_kg?.toString() ?? '');
  const [cameraView, setCameraView] = useState(video.camera_view ?? '');
  const [notes, setNotes] = useState(video.notes ?? '');

  const mutation = useMutation({
    mutationFn: () =>
      updateLiftVideo(authFetch, video.id, {
        exercise_name: exerciseName.trim() || null,
        expected_reps:
          expectedReps === '' ? null : Math.max(0, parseInt(expectedReps, 10) || 0),
        reps_count:
          repsCount === '' ? null : Math.max(0, parseInt(repsCount, 10) || 0),
        weight_kg: weightKg === '' ? null : Math.max(0, parseFloat(weightKg) || 0),
        camera_view: cameraView || null,
        notes: notes.trim() || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lift-videos'] });
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} size="sm" aria-label="Edit video">
      <ModalHeader title="Edit video" onClose={onClose} icon="✎" />

      <div className="space-y-3">
        <div>
          <label className="block text-sm text-muted mb-1">Exercise</label>
          <input
            value={exerciseName}
            onChange={(e) => setExerciseName(e.target.value)}
            placeholder="e.g. Back Squat"
            className={FIELD}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-muted mb-1">Load (kg)</label>
            <input
              type="number"
              min={0}
              step="0.5"
              value={weightKg}
              onChange={(e) => setWeightKg(e.target.value)}
              placeholder="e.g. 140"
              className={FIELD}
            />
          </div>
          <div>
            <label className="block text-sm text-muted mb-1">
              Expected reps <span className="text-muted/70">(detection)</span>
            </label>
            <input
              type="number"
              min={0}
              value={expectedReps}
              onChange={(e) => setExpectedReps(e.target.value)}
              placeholder="e.g. 5"
              className={FIELD}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm text-muted mb-1">
            Reps counted{' '}
            <span className="text-muted/70">(override the detected count)</span>
          </label>
          <input
            type="number"
            min={0}
            value={repsCount}
            onChange={(e) => setRepsCount(e.target.value)}
            placeholder="e.g. 5"
            className={FIELD}
          />
        </div>

        <div>
          <label className="block text-sm text-muted mb-1">Camera angle</label>
          <select
            value={cameraView}
            onChange={(e) => setCameraView(e.target.value)}
            className={FIELD}
          >
            <option value="">Not sure</option>
            <option value="side">Side-on</option>
            <option value="back_left">Behind, left</option>
            <option value="back_right">Behind, right</option>
            <option value="front">Front-facing</option>
          </select>
        </div>

        <div>
          <label className="block text-sm text-muted mb-1">Notes</label>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="optional"
            className={FIELD}
          />
        </div>

        {mutation.isError && (
          <p role="alert" className="text-xs text-warning">
            Couldn&apos;t save — please try again.
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-muted hover:text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="px-4 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg disabled:opacity-50"
          >
            {mutation.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>

        <p className="text-[11px] text-muted">
          Corrections apply immediately; use <strong>Reprocess</strong> to re-run
          the analysis with them.
        </p>
      </div>
    </Modal>
  );
}
