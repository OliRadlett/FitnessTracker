export interface CsvSet {
  exercise_name: string;
  set_number: number;
  weight_kg: number;
  reps: number;
  rpe?: number;
  is_warmup: boolean;
}

function csvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC-4180-ish CSV for a session's sets (header + one row per set). */
export function setsToCsv(sets: CsvSet[]): string {
  const rows: (string | number)[][] = [
    ['exercise', 'set_number', 'weight_kg', 'reps', 'rpe', 'warmup'],
    ...sets.map((s) => [
      s.exercise_name,
      s.set_number,
      s.weight_kg,
      s.reps,
      s.rpe ?? '',
      s.is_warmup ? 'yes' : 'no',
    ]),
  ];
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

/** Trigger a client-side file download for text content. */
export function downloadTextFile(filename: string, content: string, mime = 'text/csv;charset=utf-8;') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
