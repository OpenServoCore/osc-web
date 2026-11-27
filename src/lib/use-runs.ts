import { useEffect, useState } from "react";
import { listRuns, type StoredRun } from "./run-folder";
import { storage } from "./use-library";

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export interface Runs {
  /** Undefined until the storage is read; newest first. */
  runs: readonly StoredRun[] | undefined;
  error: string | undefined;
  /** Reads the list again, after an import. */
  refresh: () => Promise<void>;
}

/** The identification runs in the browser's storage. */
export function useRuns(): Runs {
  const [runs, setRuns] = useState<readonly StoredRun[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const listed = await listRuns(await storage());
        if (live) setRuns(listed);
      } catch (e) {
        if (live) setError(message(e));
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  async function refresh() {
    try {
      setRuns(await listRuns(await storage()));
      setError(undefined);
    } catch (e) {
      setError(message(e));
    }
  }

  return { runs, error, refresh };
}
