'use client';
import { useEffect, useState, useCallback, useRef } from 'react';

export type AsyncStatus = 'idle' | 'loading' | 'success' | 'error';

export interface AsyncDataState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  status: AsyncStatus;
  /** True when the fetch returned a "no items" result. Caller-controlled
   *  via the `isEmpty` option since "empty" means different things for
   *  arrays, paginated responses, and detail objects. */
  isEmpty: boolean;
  /** Manual re-fetch — the request is also re-sent automatically when any
   *  dependency in `deps` changes. */
  refetch: () => void;
}

/**
 * Standard async-data hook that produces explicit loading / error / empty
 * states so every async UI in the viewer can render the same way.
 *
 * The fetcher receives an AbortSignal so a re-fetch (deps change or
 * unmount) cancels the in-flight request rather than racing it.
 */
export function useAsyncData<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: ReadonlyArray<unknown> = [],
  options: { isEmpty?: (data: T) => boolean } = {},
): AsyncDataState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [status, setStatus] = useState<AsyncStatus>('idle');
  const [tick, setTick] = useState(0); // increments to trigger refetch

  // Keep the empty-check function ref-stable so callers can pass an inline
  // arrow without forcing a refetch on every render.
  const isEmptyRef = useRef(options.isEmpty);
  isEmptyRef.current = options.isEmpty;

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setStatus('loading');
    setError(null);

    fetcherRef.current(controller.signal).then(
      (result) => {
        if (cancelled) return;
        setData(result);
        setStatus('success');
      },
      (err) => {
        if (cancelled || controller.signal.aborted) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setStatus('error');
      },
    );

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  return {
    data,
    error,
    status,
    loading: status === 'loading',
    isEmpty:
      status === 'success' && data !== null && (isEmptyRef.current?.(data) ?? false),
    refetch,
  };
}
