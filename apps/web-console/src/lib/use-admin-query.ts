"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, classifyQueryError, type QueryError } from "./api";

type Loader = typeof apiFetch;

export function useAdminQuery<T>(
  path: string,
  load: Loader = apiFetch
): {
  data: T | null;
  loading: boolean;
  error: QueryError | null;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<QueryError | null>(null);
  const [tick, setTick] = useState(0);
  const seenPath = useRef<string | null>(null);
  const hasDataRef = useRef(false);

  const reload = useCallback(() => {
    setTick((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const pathChanged = seenPath.current !== path;
    seenPath.current = path;
    if (pathChanged) {
      hasDataRef.current = false;
      setData(null);
    }
    if (!hasDataRef.current) setLoading(true);
    setError(null);
    load<T>(path)
      .then((value) => {
        if (!cancelled) {
          hasDataRef.current = true;
          setData(value);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(classifyQueryError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, tick, load]);

  return { data, loading, error, reload };
}
