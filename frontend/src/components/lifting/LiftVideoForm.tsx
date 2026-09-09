'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch, getVideoUploadUrl, createLiftVideo } from '@/lib/api';
import type { LiftingSession, PersonalRecord } from '@/lib/api';
import { Modal, ModalHeader } from '@/components/ui/Modal';
import { ExerciseAutocomplete } from '@/components/ui/ExerciseAutocomplete';

const MAX_FILE_SIZE = 250 * 1024 * 1024;
const ALLOWED_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];
const TYPE_LABELS: Record<string, string> = {
  'video/mp4': 'MP4',
  'video/quicktime': 'QuickTime',
  'video/webm': 'WebM',
};

interface LiftVideoFormProps {
  open: boolean;
  onClose: () => void;
  sessions: LiftingSession[];
  prs: PersonalRecord[];
}

export function LiftVideoForm({ open, onClose, sessions, prs }: LiftVideoFormProps) {
  const { authFetch } = useAuthFetch();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [exerciseName, setExerciseName] = useState('');
  const [notes, setNotes] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [prId, setPrId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  useEffect(() => {
    if (open) {
      setExerciseName('');
      setNotes('');
      setSessionId('');
      setPrId('');
      setFile(null);
      setUploadProgress(0);
    }
  }, [open]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!ALLOWED_TYPES.includes(f.type)) {
      alert(`Unsupported format. Allowed: ${ALLOWED_TYPES.join(', ')}`);
      return;
    }
    if (f.size > MAX_FILE_SIZE) {
      alert(`File too large (${(f.size / (1024 * 1024)).toFixed(1)} MB). Max: 250 MB.`);
      return;
    }
    setFile(f);
  };

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      createLiftVideo(authFetch, data as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lift-videos'] });
      onClose();
    },
    onError: (err: Error) => {
      alert(`Failed: ${err.message}`);
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const base: Record<string, unknown> = {
      exercise_name: exerciseName || null,
      notes: notes || null,
      lifting_session_id: sessionId || null,
      personal_record_id: prId || null,
    };

    if (!file) {
      alert('Please select a file to upload');
      return;
    }

    try {
      const uploadRes = await getVideoUploadUrl(authFetch, {
        file_name: file.name,
        content_type: file.type,
        size_bytes: file.size,
      });

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) {
            setUploadProgress(Math.round((ev.loaded / ev.total) * 100));
          }
        };
        xhr.onload = () => {
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error(`Upload failed: ${xhr.status}`));
        };
        xhr.onerror = () => reject(new Error('Upload failed'));
        xhr.open('PUT', uploadRes.upload_url, true);
        xhr.setRequestHeader('Content-Type', file.type);
        xhr.send(file);
      });

      await createMutation.mutateAsync({
        ...base,
        r2_key: uploadRes.key,
        file_name: file.name,
        content_type: file.type,
        size_bytes: file.size,
      });
    } catch (err: any) {
      alert(`Upload failed: ${err.message || err}`);
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="lg" aria-label="Add strength video">
      <ModalHeader title="Add Strength Video" onClose={onClose} icon="📹" />

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm text-muted mb-1">Video file</label>
          <input
            ref={fileInputRef}
            type="file"
            accept={ALLOWED_TYPES.join(',')}
            onChange={handleFileChange}
            className="w-full text-sm text-muted file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-surface-light file:text-white hover:file:bg-surface-light/70"
          />
          {file && (
            <p className="text-xs text-muted mt-1">
              {file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB · {TYPE_LABELS[file.type] || file.type}
            </p>
          )}
          {uploadProgress > 0 && (
            <div className="w-full bg-surface-light rounded-full h-2 mt-2 overflow-hidden">
              <div
                className="h-2 bg-accent rounded-full transition-all"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm text-muted mb-1">Exercise</label>
          <ExerciseAutocomplete
            value={exerciseName}
            onChange={setExerciseName}
            placeholder="e.g. Bench Press"
          />
        </div>

        <div>
          <label className="block text-sm text-muted mb-1">Link to session (optional)</label>
          <select
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
          >
            <option value="">None</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.focus || 'General Session'} · {new Date(s.session_date).toLocaleDateString()}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm text-muted mb-1">Link to PR (optional)</label>
          <select
            value={prId}
            onChange={(e) => setPrId(e.target.value)}
            className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
          >
            <option value="">None</option>
            {prs.map((pr) => (
              <option key={pr.id} value={pr.id}>
                {pr.exercise_name} · {pr.weight_kg} kg × {pr.reps}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm text-muted mb-1">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes"
            rows={3}
            className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
          >
            {createMutation.isPending ? 'Saving...' : 'Save Video'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
