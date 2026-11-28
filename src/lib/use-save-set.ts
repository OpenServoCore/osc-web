import type { SaveOutcome } from "@openservocore/client-ident";
import type { BaudRate } from "@openservocore/client";
import { useRef, useState } from "react";
import { useBus } from "./bus/hooks";
import { handOver } from "./ident-run";
import { openIdentWorker } from "./ident-worker";
import { mirrorInto } from "./run-mirror";
import { saveArgs } from "./save-set";
import { storage } from "./use-library";

export interface SaveView {
  phase: "ready" | "saving" | "ended";
  outcome: SaveOutcome | undefined;
  /** A throw: the module, the handover or the storage. */
  failure: string | undefined;
}

const READY: SaveView = { phase: "ready", outcome: undefined, failure: undefined };

/**
 * "Save this set" for the stored run at `<uid>/<UTC>`: the identification module's save, the CLI's
 * `save --set` then `check --set`, in a worker of its own inside the bus manager's exclusive turn,
 * the main client's device lent and always taken back, the save's backup folder mirrored into the
 * browser's storage beside the run's. `ended` is called once it is over, the bus back.
 */
export function useSaveSet(
  simulated: boolean,
  ended: () => void,
): { view: SaveView; save: (id: number, at: string, baud: BaudRate | undefined) => Promise<void> } {
  const bus = useBus();
  const [view, setView] = useState<SaveView>(READY);
  const busy = useRef(false);

  async function save(id: number, at: string, baud: BaudRate | undefined) {
    if (busy.current) return;
    busy.current = true;
    setView({ ...READY, phase: "saving" });
    let outcome: SaveOutcome | undefined;
    let failure: string | undefined;
    try {
      const root = await storage();
      const args = await saveArgs(root, id, at, baud);
      const mirror = mirrorInto(root);
      const worker = await openIdentWorker();
      try {
        outcome = await bus.exclusive((client) =>
          handOver(client, (device) => {
            const lent = simulated ? undefined : device;
            if (!simulated && lent === undefined) {
              throw new Error("the adapter lent no device for the save");
            }
            const ignore = () => undefined;
            const go =
              lent === undefined
                ? worker.saveFake(args, ignore, mirror.onStore)
                : worker.save(lent, args, ignore, mirror.onStore);
            return go.catch((e: unknown) => {
              worker.close();
              throw e;
            });
          }),
        );
      } finally {
        worker.close();
      }
      const lost = mirror.failure();
      if (lost !== undefined)
        failure = `The save's backup was not all kept in this browser: ${lost}`;
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    } finally {
      busy.current = false;
    }
    setView({ phase: "ended", outcome, failure });
    ended();
  }

  return { view, save };
}
