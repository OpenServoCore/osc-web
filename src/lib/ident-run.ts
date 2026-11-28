import type { ResumeArgs, RunArgs, RunFile, RunOutcome } from "@openservocore/client-ident";
import type { ServoProfile, Stored, TuningPolicy } from "./library";
import { listTree, readFile, removeDir, type OpfsDir } from "./opfs";
import { DEFAULT_KEY, DEFAULT_POLICY } from "./policy-form";
import { importRun, locateRun, type PickedRun, type RunIdentity } from "./run-folder";

const DEFAULT_PATH = `policies/${DEFAULT_KEY}.json`;

/** The Default policy as a run is given it when the library holds none. */
function defaultPolicyBytes(): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(DEFAULT_POLICY, null, 2)}\n`);
}

/** The run's arguments: the profile and the policy at their library paths, as the CLI names its files. */
export function runArgs(
  id: number,
  profile: Stored<ServoProfile>,
  policy: Stored<TuningPolicy> | null,
): RunArgs {
  const nameplate = `profiles/${profile.value.key}.json`;
  const policyPath = `policies/${policy?.value.key ?? DEFAULT_KEY}.json`;
  const policyBytes = policy?.bytes ?? defaultPolicyBytes();
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

/** Whether a stored run can be offered a resume: it did not get through the final check. */
export function stopped(identity: RunIdentity): boolean {
  return identity.steps.find((s) => s.name === "final")?.state !== "accepted";
}

function givenPath(doc: unknown, key: "nameplate" | "policy"): string | undefined {
  if (typeof doc !== "object" || doc === null) return undefined;
  const given = (doc as { given?: Record<string, { path?: unknown } | undefined> }).given;
  const path = given?.[key]?.path;
  return typeof path === "string" ? path : undefined;
}

/**
 * The arguments that resume the stored run at `at` (`<uid>/<UTC>`) on servo `id`: the profile and
 * the policy at the paths its `run.json` records, read from the library (the Default policy as a
 * run is given it), and every file of the folder. Where `run.json` records no paths, those of
 * `fallback`, the servo's setup now, so the module can say why it refuses. A file not in the
 * library is left out, for the module to name.
 */
export async function resumeArgs(
  root: OpfsDir,
  id: number,
  at: string,
  fallback: { nameplate: string; policy: string } | undefined,
): Promise<ResumeArgs> {
  const record = await readFile(root, `${at}/run.json`);
  let doc: unknown;
  try {
    doc = record === null ? undefined : JSON.parse(new TextDecoder().decode(record));
  } catch {
    doc = undefined;
  }
  const nameplate = givenPath(doc, "nameplate") ?? fallback?.nameplate ?? "profiles/none.json";
  const policy = givenPath(doc, "policy") ?? fallback?.policy ?? DEFAULT_PATH;
  const files: RunFile[] = [];
  for (const path of new Set([nameplate, policy])) {
    const bytes =
      (await readFile(root, path).catch(() => null)) ??
      (path === DEFAULT_PATH ? defaultPolicyBytes() : null);
    if (bytes !== null) files.push({ path, bytes });
  }
  for (const f of await listTree(root, at)) {
    const bytes = await readFile(root, `${at}/${f.path}`);
    if (bytes !== null) files.push({ path: `${at}/${f.path}`, bytes });
  }
  return { id, nameplate, policy, folder: at, files };
}

/**
 * The run folder an outcome holds, written over whatever the mirror left at `<uid>/<UTC>/`: for a
 * mirror that could not apply every change. The outcome carries the folder whole.
 */
export async function rewriteOutcome(
  root: OpfsDir,
  outcome: RunOutcome,
): Promise<PickedRun | undefined> {
  const run = outcomeRun(outcome);
  if (run === undefined) return undefined;
  await removeDir(root, `${run.identity.uid}/${run.identity.utc}`);
  await importRun(root, run);
  return run;
}
