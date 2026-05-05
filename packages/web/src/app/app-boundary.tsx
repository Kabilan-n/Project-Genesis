'use client';
import { ErrorBoundary } from 'react-error-boundary';
import { AppErrorFallback } from '../components/ErrorFallbacks';

/**
 * Client-side boundary wrapper. Lives in its own file because layout.tsx
 * is a Server Component and cannot register error handlers directly.
 */
export function AppBoundary({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary
      FallbackComponent={AppErrorFallback}
      onError={(error, info) => {
        // Log to console for now; Phase 8 wires this to a real reporter.
        console.error('[AppBoundary] crash:', error, info?.componentStack);
      }}
    >
      {children}
    </ErrorBoundary>
  );
}
