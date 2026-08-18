"use client";

import type { ReactNode } from "react";
import type { QueryError } from "../lib/api";

export function QueryStatus({
  loading,
  error,
  onRetry,
  children,
  className = "page",
}: {
  loading: boolean;
  error: QueryError | null;
  onRetry?: () => void;
  children: ReactNode;
  className?: string;
}) {
  if (loading) return <div className={`${className} loading`}>加载中...</div>;
  if (error) {
    return (
      <div className={`${className} error-box`}>
        <p>{error.message}</p>
        {error.kind === "network" && onRetry ? (
          <button type="button" className="btn btn-primary" onClick={onRetry}>
            重试
          </button>
        ) : null}
      </div>
    );
  }
  return <>{children}</>;
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return <div className="card empty">{children}</div>;
}
