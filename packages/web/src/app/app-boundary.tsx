'use client';
import { ErrorBoundary } from 'react-error-boundary';
import { AppErrorFallback } from '../components/ErrorFallbacks';
import { useAuthRedirect } from '../lib/useAuthRedirect';

/**
 * Client-side boundary wrapper. Lives in its own file because layout.tsx
 * is a Server Component and cannot register error handlers directly.
 *
 * Also mounts useAuthRedirect once at the root so a refresh-token rejection
 * inside apiFetch reliably pushes the user back to /login instead of
 * leaving them on a protected page with a now-null token.
 */
export function AppBoundary({ children }: { children: React.ReactNode }) {
  useAuthRedirect();
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
