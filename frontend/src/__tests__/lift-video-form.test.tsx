import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LiftVideoForm } from '@/components/lifting/LiftVideoForm';
import type { LiftingSession, PersonalRecord } from '@/lib/api';

// Mock useAuthFetch to avoid real API calls
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    useAuthFetch: () => ({ authFetch: vi.fn() }),
    createLiftVideo: vi.fn(),
    getVideoUploadUrl: vi.fn(),
  };
});

// Mock Modal to always render children (avoid portal issues in jsdom)
vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ open, children }: any) => (open ? <div data-testid="modal">{children}</div> : null),
  ModalHeader: ({ title }: any) => <h2>{title}</h2>,
}));

// Mock ExerciseAutocomplete to render a plain input
vi.mock('@/components/ui/ExerciseAutocomplete', () => ({
  ExerciseAutocomplete: ({ value, onChange, placeholder }: any) => (
    <input
      data-testid="exercise-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  ),
}));

const mockSessions: LiftingSession[] = [
  {
    id: 's1',
    session_date: '2026-09-01',
    focus: 'Push Day',
    total_volume_kg: 5000,
    rpe_session: 7,
    duration_seconds: 3600,
  } as LiftingSession,
];

const mockPrs: PersonalRecord[] = [
  {
    id: 'pr1',
    exercise_name: 'Bench Press',
    weight_kg: 120,
    reps: 1,
    achieved_date: '2026-08-15',
  } as PersonalRecord,
];

function renderForm(open: boolean = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LiftVideoForm
        open={open}
        onClose={vi.fn()}
        sessions={mockSessions}
        prs={mockPrs}
      />
    </QueryClientProvider>,
  );
}

describe('LiftVideoForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('alert', vi.fn());
  });

  it('renders the form when open', () => {
    renderForm();
    expect(screen.getByText('Add Strength Video')).toBeInTheDocument();
    expect(screen.getByText('Save Video')).toBeInTheDocument();
  });

  it('does not render when open=false', () => {
    const { container } = renderForm(false);
    expect(container.querySelector('[data-testid="modal"]')).toBeNull();
  });

  it('shows the file picker (upload-only, no URL mode)', () => {
    const { container } = renderForm();
    expect(screen.getByText('Video file')).toBeInTheDocument();
    expect(container.querySelector('input[type="file"]')).toBeInTheDocument();
    expect(screen.queryByText('External URL (YouTube/Vimeo)')).toBeNull();
  });

  it('alerts when submitting without selecting a file', () => {
    renderForm();
    fireEvent.click(screen.getByText('Save Video'));
    expect(window.alert).toHaveBeenCalledWith('Please select a file to upload');
  });

  it('rejects unsupported file formats', () => {
    const { container } = renderForm();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const badFile = new File(['x'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [badFile] } });
    expect(window.alert).toHaveBeenCalledWith(
      expect.stringContaining('Unsupported format'),
    );
  });

  it('rejects files over 250 MB', () => {
    const { container } = renderForm();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const bigFile = { name: 'huge.mp4', size: 300 * 1024 * 1024, type: 'video/mp4' };
    fireEvent.change(input, { target: { files: [bigFile] } });
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('File too large'));
  });

  it('populates session dropdown', () => {
    renderForm();
    expect(screen.getByText(/Push Day/)).toBeInTheDocument();
  });

  it('populates PR dropdown', () => {
    renderForm();
    expect(screen.getByText(/Bench Press/)).toBeInTheDocument();
  });

  it('cancel button calls onClose', () => {
    const onClose = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <LiftVideoForm
          open={true}
          onClose={onClose}
          sessions={mockSessions}
          prs={mockPrs}
        />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });
});
