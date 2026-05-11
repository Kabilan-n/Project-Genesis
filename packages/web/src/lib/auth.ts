'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AuthUser {
  user_id: string;
  username: string;
  email: string;
}

interface AuthStore {
  token: string | null;
  user: AuthUser | null;
  setAuth: (token: string, user: AuthUser) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setAuth: (token, user) => set({ token, user }),
      clearAuth: () => set({ token: null, user: null }),
    }),
    { name: 'genesis-auth' }
  )
);

export function getApiUrl(): string {
  if (typeof window !== 'undefined' && (window as any).__genesis?.apiUrl) {
    return (window as any).__genesis.apiUrl;
  }
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
}

/** Default timeout for API calls. Overridable per-call via timeoutMs. */
export const API_DEFAULT_TIMEOUT_MS = 30_000;

export class ApiTimeoutError extends Error {
  constructor(public readonly path: string, public readonly timeoutMs: number) {
    super(`Request to ${path} timed out after ${timeoutMs}ms`);
    this.name = 'ApiTimeoutError';
  }
}

/**
 * Refresh the access token using the HttpOnly refresh cookie.
 * Concurrent calls collapse to a single in-flight request.
 */
let refreshPromise: Promise<string | null> | null = null;
async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const res = await fetch(`${getApiUrl()}/auth/refresh`, {
        method: 'POST',
        credentials: 'include', // send the refresh cookie
      });
      if (!res.ok) {
        useAuthStore.getState().clearAuth();
        return null;
      }
      const body = await res.json();
      if (body?.token && body?.user) {
        useAuthStore.getState().setAuth(body.token, body.user);
        return body.token as string;
      }
      return null;
    } catch {
      return null;
    } finally {
      // Clear the singleton AFTER the response so the next 401 picks up
      // the newly-stored token rather than racing.
      setTimeout(() => { refreshPromise = null; }, 0);
    }
  })();
  return refreshPromise;
}

async function fetchOnce(
  path: string,
  init: RequestInit & { timeoutMs?: number },
  token: string | null,
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const timeoutMs = init.timeoutMs ?? API_DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  if (init.signal) {
    if (init.signal.aborted) controller.abort();
    else init.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    return await fetch(`${getApiUrl()}${path}`, {
      ...init,
      headers,
      credentials: 'include', // send the refresh cookie alongside Bearer
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      if (!init.signal?.aborted) {
        throw new ApiTimeoutError(path, timeoutMs);
      }
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Authenticated fetch with a default 30s timeout via AbortController.
 * Pass `timeoutMs` to override (slow endpoints like biography generation
 * should pass a longer value). Pass an external `signal` and we'll wire
 * both signals together so user-cancellation still works.
 *
 * On a 401 response we transparently try to refresh the access token via
 * the cookie-borne refresh token and replay the request once. On refresh
 * failure the auth store is cleared and the 401 propagates.
 */
export async function apiFetch(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  let token = useAuthStore.getState().token;
  let res = await fetchOnce(path, init, token);

  // Don't try to refresh on /auth/refresh itself or /auth/logout — those
  // calls drive the refresh flow themselves.
  if (res.status === 401 && !path.startsWith('/auth/refresh') && !path.startsWith('/auth/logout')) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      res = await fetchOnce(path, init, newToken);
    }
  }
  return res;
}
