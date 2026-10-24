import { useCallback, useEffect, useState } from "react";
import { type ApiErrorKind, isApiError } from "../api/client";

export type Remote<T> =
  | { state: "loading" }
  | { state: "ready"; data: T }
  | { state: "error"; kind: ApiErrorKind };

/**
 * Loads `load()` when `key` changes, with `reload()` for the retry button. An answer for an older
 * key is dropped, so a fast typist never sees the results of an earlier search.
 */
export function useRemote<T>(
  key: string | null,
  load: () => Promise<T>,
): Remote<T> & { reload: () => void } {
  const [result, setResult] = useState<Remote<T>>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` names what `load` fetches
  useEffect(() => {
    if (key === null) return;
    let current = true;
    setResult({ state: "loading" });
    load().then(
      (data) => current && setResult({ state: "ready", data }),
      (error: unknown) =>
        current &&
        setResult({ state: "error", kind: isApiError(error) ? error.kind : "unavailable" }),
    );
    return () => {
      current = false;
    };
  }, [key, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...result, reload };
}
