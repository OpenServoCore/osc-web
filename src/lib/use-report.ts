import { useEffect, useState } from "react";
import { readFile } from "./opfs";
import { readDocs, runAt, runTimes, type RunDocs, type RunTimes } from "./report";
import { identityOf, readRunJson, type RunIdentity } from "./run-folder";
import { storage } from "./use-library";

export interface LoadedRun {
  identity: RunIdentity;
  times: RunTimes;
  docs: RunDocs;
}

export interface RunReport {
  /** Undefined while the storage is read. */
  run: LoadedRun | undefined;
  /** The run is not in the browser, or its files do not read. */
  error: string | undefined;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** One run's report files from the browser's storage. */
export function useRunReport(uid: string, utc: string): RunReport {
  const [state, setState] = useState<RunReport>({ run: undefined, error: undefined });

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const root = await storage();
        const record = await readFile(root, `${runAt(uid, utc)}/run.json`);
        if (record === null) {
          if (live) {
            setState({
              run: undefined,
              error: `No run ${uid}/${utc}/ is in this browser: open its folder on the Runs page.`,
            });
          }
          return;
        }
        const docs = await readDocs(root, uid, utc);
        const resolved = await readFile(root, `${runAt(uid, utc)}/inputs/resolved.json`);
        const run: LoadedRun = {
          identity: identityOf(readRunJson(record), utc, resolved),
          times: runTimes(docs.get("run.json")),
          docs,
        };
        if (live) setState({ run, error: undefined });
      } catch (e) {
        if (live) setState({ run: undefined, error: message(e) });
      }
    })();
    return () => {
      live = false;
    };
  }, [uid, utc]);

  return state;
}
