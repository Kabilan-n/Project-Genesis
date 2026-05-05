'use client';
import type { FallbackProps } from 'react-error-boundary';

/**
 * App-level fallback rendered when the entire viewer crashes.
 * Used by the root error boundary in layout.tsx.
 */
export function AppErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-100 p-8">
      <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-lg p-6 space-y-4">
        <h1 className="text-xl font-semibold text-red-400">Something broke.</h1>
        <p className="text-sm text-zinc-400">
          The viewer hit an unexpected error and stopped rendering. The
          simulation itself keeps running — you can reload to recover.
        </p>
        <pre className="text-xs bg-zinc-950 border border-zinc-800 rounded p-3 max-h-40 overflow-auto text-zinc-500">
          {error?.message ?? 'Unknown error'}
        </pre>
        <div className="flex gap-2">
          <button
            onClick={resetErrorBoundary}
            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-sm"
          >
            Try again
          </button>
          <button
            onClick={() => location.reload()}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm"
          >
            Reload page
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Per-panel fallback. Smaller and inline so a crash in one panel doesn't
 * blank the whole viewer; only that panel renders an error notice.
 */
export function PanelErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div className="p-4 m-2 bg-red-950/40 border border-red-900/50 rounded text-sm space-y-2">
      <div className="font-medium text-red-300">This panel hit an error.</div>
      <div className="text-xs text-red-400/70 truncate">
        {error?.message ?? 'Unknown error'}
      </div>
      <button
        onClick={resetErrorBoundary}
        className="text-xs px-2 py-1 bg-red-900/40 hover:bg-red-900/60 rounded"
      >
        Reload panel
      </button>
    </div>
  );
}
