import { useEffect, useState } from "react";
import { listSetups, readSetup, writeSetup, type ServoSetup } from "./library";
import { storage } from "./use-library";

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const NONE: ServoSetup = { profile: null, policy: null };

export interface Setup {
  /** Undefined until read; a servo never set up reads as no profile and Default. */
  setup: ServoSetup | undefined;
  error: string | undefined;
  /** Writes `<uid>/setup.json` at once. */
  choose: (next: ServoSetup) => Promise<void>;
}

/** One servo's choice of profile and policy, kept under its uid. */
export function useSetup(uid: string): Setup {
  const [setup, setSetup] = useState<ServoSetup>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const read = await readSetup(await storage(), uid);
        if (live) setSetup(read ?? NONE);
      } catch (e) {
        if (live) setError(message(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [uid]);

  async function choose(next: ServoSetup) {
    await writeSetup(await storage(), uid, next);
    setSetup(next);
    setError(undefined);
  }

  return { setup, error, choose };
}

/** Every servo's setup in the browser, read once. */
export function useSetups(): {
  setups: ReadonlyMap<string, ServoSetup> | undefined;
  error?: string;
} {
  const [setups, setSetups] = useState<ReadonlyMap<string, ServoSetup>>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const listed = await listSetups(await storage());
        if (live) setSetups(listed);
      } catch (e) {
        if (live) setError(message(e));
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  return { setups, error };
}
