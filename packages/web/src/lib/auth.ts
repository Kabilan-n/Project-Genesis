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
 * Authenticated fetch with a default 30s timeout via AbortController.
 * Pass `timeoutMs` to override (slow endpoints like biography generation
 * should pass a longer value). Pass an external `signal` and we'll wire
 * both signals together so user-cancellation still works.
 */
export async function apiFetch(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const token = useAuthStore.getState().token;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const timeoutMs = init.timeoutMs ?? API_DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // If the caller passed their own signal, abort our controller when
  // theirs aborts (so navigation-away cancellation propagates).
  if (init.signal) {
    if (init.signal.aborted) {
      controller.abort();
    } else {
      init.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }

  try {
    return await fetch(`${getApiUrl()}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      // Distinguish our timeout from a user-driven abort.
      if (!init.signal?.aborted) {
        throw new ApiTimeoutError(path, timeoutMs);
      }
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
