'use client';
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from './auth';

/**
 * Watches the auth token and redirects to /login if it clears while the
 * user is inside a protected subtree (currently /viewer/*). Resolves the
 * Phase 6 follow-up where apiFetch silently cleared the store on a
 * refresh-rejected 401 but the UI didn't actually push them away.
 *
 * Mount once at the layout level. Subscribing to the Zustand store via
 * useAuthStore() re-renders this component when the token changes;
 * router.replace handles the navigation.
 */
export function useAuthRedirect() {
  const router = useRouter();
  const pathname = usePathname();
  const token = useAuthStore((s) => s.token);

  useEffect(() => {
    if (token) return; // signed in: nothing to do
    if (!pathname) return;
    // Only redirect from protected routes — leaving the landing page
    // and /login alone.
    const protectedPrefixes = ['/viewer', '/onboarding'];
    if (protectedPrefixes.some((p) => pathname.startsWith(p))) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [token, pathname, router]);
}
