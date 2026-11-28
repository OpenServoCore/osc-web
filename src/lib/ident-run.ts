import type { RunArgs, RunOutcome } from "@openservocore/client-ident";
import type { ServoProfile, Stored, TuningPolicy } from "./library";
import type { OpfsDir } from "./opfs";
import { DEFAULT_KEY, DEFAULT_POLICY } from "./policy-form";
import { importRun, locateRun, type PickedRun } from "./run-folder";

/** The run's arguments: the profile and the policy at their library paths, as the CLI names its files. */
export function runArgs(
  id: number,
  profile: Stored<ServoProfile>,
  policy: Stored<TuningPolicy> | null,
): RunArgs {
  const nameplate = `profiles/${profile.value.key}.json`;
  const policyPath = `policies/${policy?.value.key ?? DEFAULT_KEY}.json`;
  const policyBytes =
    policy?.bytes ?? new TextEncoder().encode(`${JSON.stringify(DEFAULT_POLICY, null, 2)}\n`);
  return {
    id,
    nameplate,
    policy: policyPath,
    files: [
      { path: nameplate, bytes: profile.bytes },
      { path: policyPath, bytes: policyBytes },
    ],
  };
}

/** The client side of the handover: the main module's client lends the device and takes it back. */
export interface Lender {
  release(): Promise<USBDevice | undefined>;
  reclaim(): Promise<unknown>;
}

/**
 * Lends the bus to `run` and always takes it back, a run that throws too:
 * the device is the main client's again before this settles. A failure to
 * take it back is thrown, after the run's own failure if it had one.
 */
export async function handOver<T>(
  client: Lender,
  run: (device: USBDevice | undefined) => Promise<T>,
): Promise<T> {
  let failure: { e: unknown } | undefined;
  let result: T | undefined;
  try {
    result = await run(await client.release());
  } catch (e) {
    failure = { e };
  }
  try {
    await client.reclaim();
  } catch (e) {
    failure ??= { e };
  }
  if (failure !== undefined) throw failure.e;
  return result as T;
}

/** The run folder an outcome holds, as an import of it would take it; undefined when the run named none. */
export function outcomeRun(outcome: RunOutcome): PickedRun | undefined {
  if (outcome.root === undefined || outcome.files.length === 0) return undefined;
  return locateRun(outcome.files.map((f) => ({ path: f.path, bytes: new Uint8Array(f.bytes) })));
}

/** Copies the run folder into the browser's storage at `<uid>/<UTC>/`, byte for byte. */
export async function storeOutcome(
  root: OpfsDir,
  outcome: RunOutcome,
): Promise<PickedRun | undefined> {
  const run = outcomeRun(outcome);
  if (run !== undefined) await importRun(root, run);
  return run;
}
