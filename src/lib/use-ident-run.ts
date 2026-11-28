import type { Progress, ResumeArgs, RunArgs, RunOutcome } from "@openservocore/client-ident";
import type { IdentWorker } from "@openservocore/client-ident/host";
import { useRef, useState } from "react";
import { useBus } from "./bus/hooks";
import { handOver, outcomeRun, rewriteOutcome } from "./ident-run";
import { openIdentWorker } from "./ident-worker";
import type { PickedRun } from "./run-folder";
import { mirrorInto } from "./run-mirror";
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
  /** The stored folder (`<uid>/<UTC>`) a resume goes on in; undefined for a new run. */
  resuming: string | undefined;
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
  resuming: undefined,
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
  /** Goes on with the stopped run `args.folder`; the resume tells each step it reuses first. */
  resume: (target: RunTarget, args: ResumeArgs) => Promise<void>;
  cancel: () => void;
  /** Back to before Start once a run has ended, for the next one. */
  reset: () => void;
}

/** The run in `run`, on `device`, or on the simulated servo where none is lent. */
type Go = (
  run: IdentWorker,
  device: USBDevice | undefined,
  told: (p: Progress) => void,
  mirror: ReturnType<typeof mirrorInto>,
) => Promise<RunOutcome>;

/**
 * One identification run at a time from this page, each in a worker of its own: the bus
 * manager's exclusive turn for the whole run, the main client's device lent to the worker and
 * always taken back, the screen kept on, each file the run writes mirrored into the browser's
 * storage as it is written, so a tab closed mid-run leaves the folder a resume goes on from.
 * `ended` is called once the run is over, the bus back.
 */
export function useIdentRun(simulated: boolean, ended: () => void): IdentRunner {
  const bus = useBus();
  const [view, setView] = useState<RunView>(READY);
  const handle = useRef<IdentWorker>(undefined);
  const cancelled = useRef(false);
  const busy = useRef(false);

  async function go(target: RunTarget, resuming: string | undefined, run: Go) {
    if (busy.current) return;
    busy.current = true;
    cancelled.current = false;
    setView({ ...READY, phase: "loading", target, resuming });
    const wake = holdScreen();
    let outcome: RunOutcome | undefined;
    let stored: PickedRun | undefined;
    let failure: string | undefined;
    try {
      const root = await storage();
      const mirror = mirrorInto(root);
      const worker = await openIdentWorker();
      handle.current = worker;
      // A Cancel while the module loaded stops the run at its first step, as a stop raised before it.
      if (cancelled.current) worker.stop();
      setView((v) => ({ ...v, phase: "running" }));
      const told = (p: Progress) => {
        setView((v) => ({ ...v, feed: feedReduce(v.feed, p) }));
      };
      try {
        outcome = await bus.exclusive((client) =>
          handOver(client, (device) => {
            const lent = simulated ? undefined : device;
            if (!simulated && lent === undefined) {
              throw new Error("the adapter lent no device for the run");
            }
            return run(worker, lent, told, mirror).catch((e: unknown) => {
              // A worker that failed may still hold the device; ending it frees the device for the reclaim.
              worker.close();
              throw e;
            });
          }),
        );
      } finally {
        handle.current = undefined;
        worker.close();
      }
      const out = outcome;
      setView((v) => ({ ...v, phase: "saving", outcome: out }));
      // The worker settles once every change was applied: the folder is in storage already.
      stored = mirror.failure() === undefined ? outcomeRun(out) : await rewriteOutcome(root, out);
    } catch (e) {
      failure = message(e);
    } finally {
      wake();
      busy.current = false;
    }
    setView((v) => ({ ...v, phase: "ended", outcome, stored, failure }));
    ended();
  }

  function start(target: RunTarget, args: RunArgs) {
    return go(target, undefined, (worker, device, told, mirror) =>
      device === undefined
        ? worker.runFake(args, told, mirror.onStore)
        : worker.run(device, args, told, mirror.onStore),
    );
  }

  function resume(target: RunTarget, args: ResumeArgs) {
    return go(target, args.folder, (worker, device, told, mirror) =>
      device === undefined
        ? worker.resumeFake(args, told, mirror.onStore)
        : worker.resume(device, args, told, mirror.onStore),
    );
  }

  function cancel() {
    cancelled.current = true;
    handle.current?.stop();
    setView((v) => ({ ...v, cancelled: true }));
  }

  function reset() {
    if (!busy.current) setView(READY);
  }

  return { view, start, resume, cancel, reset };
}
