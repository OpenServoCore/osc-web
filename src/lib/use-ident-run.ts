import type { Progress, RunArgs, RunOutcome } from "@openservocore/client-ident";
import type { IdentWorker } from "@openservocore/client-ident/host";
import { useRef, useState } from "react";
import { useBus } from "./bus/hooks";
import { handOver, storeOutcome } from "./ident-run";
import { openIdentWorker } from "./ident-worker";
import type { PickedRun } from "./run-folder";
import { FEED_START, feedReduce, type Feed } from "./run-feed";
import { storage } from "./use-library";
import { holdScreen } from "./wake-lock";

/** Before Start, the module loading, the run on the bus, its folder going into storage, over. */
export type RunPhase = "ready" | "loading" | "running" | "saving" | "ended";

export interface RunTarget {
  id: number;
  uid: string;
}

export interface RunView {
  phase: RunPhase;
  /** The servo the run was started on; it stays the run's whatever is selected meanwhile. */
  target: RunTarget | undefined;
  feed: Feed;
  cancelled: boolean;
  outcome: RunOutcome | undefined;
  /** The run folder as stored at `<uid>/<UTC>/`. */
  stored: PickedRun | undefined;
  /** A throw: the module, the handover or the storage. */
  failure: string | undefined;
}

const READY: RunView = {
  phase: "ready",
  target: undefined,
  feed: FEED_START,
  cancelled: false,
  outcome: undefined,
  stored: undefined,
  failure: undefined,
};

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export interface IdentRunner {
  view: RunView;
  start: (target: RunTarget, args: RunArgs) => Promise<void>;
  cancel: () => void;
}

/**
 * One identification run from this page, in a worker of its own: the bus
 * manager's exclusive turn for the whole run, the main client's device lent
 * to the worker and always taken back, the screen kept on, the run folder
 * stored as the run wrote it. `ended` is called once the run is over, the
 * bus back.
 */
export function useIdentRun(simulated: boolean, ended: () => void): IdentRunner {
  const bus = useBus();
  const [view, setView] = useState<RunView>(READY);
  const handle = useRef<IdentWorker>(undefined);
  const cancelled = useRef(false);
  const started = useRef(false);

  async function start(target: RunTarget, args: RunArgs) {
    if (started.current) return;
    started.current = true;
    cancelled.current = false;
    setView({ ...READY, phase: "loading", target });
    const wake = holdScreen();
    let outcome: RunOutcome | undefined;
    let stored: PickedRun | undefined;
    let failure: string | undefined;
    try {
      const run = await openIdentWorker();
      handle.current = run;
      // A Cancel while the module loaded stops the run at its first step, as a stop raised before it.
      if (cancelled.current) run.stop();
      setView((v) => ({ ...v, phase: "running" }));
      const told = (p: Progress) => {
        setView((v) => ({ ...v, feed: feedReduce(v.feed, p) }));
      };
      try {
        outcome = await bus.exclusive((client) =>
          handOver(client, (device) => {
            if (simulated) return run.runFake(args, told);
            if (device === undefined) throw new Error("the adapter lent no device for the run");
            return run.run(device, args, told).catch((e: unknown) => {
              // A worker that failed may still hold the device; ending it frees the device for the reclaim.
              run.close();
              throw e;
            });
          }),
        );
      } finally {
        handle.current = undefined;
        run.close();
      }
      const out = outcome;
      setView((v) => ({ ...v, phase: "saving", outcome: out }));
      stored = await storeOutcome(await storage(), out);
    } catch (e) {
      failure = message(e);
    } finally {
      wake();
    }
    setView((v) => ({ ...v, phase: "ended", outcome, stored, failure }));
    ended();
  }

  function cancel() {
    cancelled.current = true;
    handle.current?.stop();
    setView((v) => ({ ...v, cancelled: true }));
  }

  return { view, start, cancel };
}
