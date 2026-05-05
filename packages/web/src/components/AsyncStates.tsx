'use client';
/**
 * Shared loading / error / empty UI primitives.
 * Pair with useAsyncData for consistent treatment across the viewer.
 */

export function LoadingSpinner({ label = 'Loading…', className = '' }: {
  label?: string; className?: string;
}) {
  return (
    <div className={`flex items-center justify-center gap-2 text-zinc-500 ${className}`}>
      <div className="w-4 h-4 rounded-full border-2 border-blue-500/30 border-t-blue-500 animate-spin" />
      <span className="text-xs">{label}</span>
    </div>
  );
}

export function InlineError({
  error, onRetry, label,
}: {
  error: Error | null; onRetry?: () => void; label?: string;
}) {
  return (
    <div className="p-3 m-2 bg-red-950/30 border border-red-900/40 rounded text-sm">
      <div className="text-red-300 font-medium">{label ?? 'Something went wrong.'}</div>
      <div className="text-xs text-red-400/70 mt-1 truncate">
        {error?.message ?? 'Unknown error'}
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-2 text-xs px-2 py-1 bg-red-900/40 hover:bg-red-900/60 rounded"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center p-6 text-xs text-zinc-500 italic">
      {label}
    </div>
  );
}
