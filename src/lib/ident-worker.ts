import { IdentWorker } from "@openservocore/client-ident/host";

/**
 * A dedicated worker for one run, its module loaded (about 1 MB gzipped, fetched on the run
 * screen only). The run lives there because a hidden tab throttles the page's timers and not a
 * dedicated worker's: a pause stretched past the servo's dead-man would stop the run.
 */
export async function openIdentWorker(): Promise<IdentWorker> {
  const worker = new IdentWorker(
    new Worker(new URL("./ident.worker.ts", import.meta.url), { type: "module" }),
  );
  try {
    await worker.ready;
  } catch (e) {
    worker.close();
    throw e;
  }
  return worker;
}
