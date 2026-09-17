'use client';

export function VideoChip({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-500/20 text-purple-400 border border-purple-500/30"
      title={`${count} strength video${count !== 1 ? 's' : ''}`}
    >
      📹 {count}
    </span>
  );
}
