import type { SaveArgs, SaveOutcome } from "@openservocore/client-ident";
import type { BaudRate } from "@openservocore/client";
import { readFile, type OpfsDir } from "./opfs";
import type { RunIdentity } from "./run-folder";

/** The final check accepted a set: the folder holds one to save. */
export function hasFinalSet(identity: RunIdentity): boolean {
  return identity.steps.find((s) => s.name === "final")?.state === "accepted";
}

/**
 * Why the run's final set cannot be saved on servo `id` (uid `uid`, or none on the bus) now, in
 * plain words; undefined when it can. The module refuses the same cases again on the bus.
 */
export function saveRefusal(
  identity: RunIdentity,
  servo: { id: number; uid: string } | undefined,
): string | undefined {
  if (!hasFinalSet(identity)) {
    return "The run's final check accepted no set: there is nothing to save. Start a new run, or resume this one.";
  }
  if (servo === undefined) {
    return `Servo ${identity.uid} is not on the bus: connect it to save this set.`;
  }
  if (servo.uid !== identity.uid) {
    return `ID ${String(servo.id)} is servo ${servo.uid}, not this run's servo ${identity.uid}: this set is for that servo only.`;
  }
  return undefined;
}

function finalSetFile(doc: unknown): string | undefined {
  if (typeof doc !== "object" || doc === null) return undefined;
  const last = (doc as { final?: { set_file?: unknown } }).final;
  return typeof last?.set_file === "string" ? last.set_file : undefined;
}

/**
 * The save's arguments for the stored run at `at` (`<uid>/<UTC>`) on servo `id`: `run.json`, the
 * final set file it names, and the table beside the final inputs, read from the browser's storage.
 * A file that is not there is left out, for the module to name.
 */
export async function saveArgs(
  root: OpfsDir,
  id: number,
  at: string,
  baud: BaudRate | undefined,
): Promise<SaveArgs> {
  const record = await readFile(root, `${at}/run.json`);
  let doc: unknown;
  try {
    doc = record === null ? undefined : JSON.parse(new TextDecoder().decode(record));
  } catch {
    doc = undefined;
  }
  const paths = ["run.json", finalSetFile(doc), "final/inputs/pos_lut.json"].filter(
    (p): p is string => p !== undefined,
  );
  const files: SaveArgs["files"] = [];
  for (const p of new Set(paths)) {
    const bytes = await readFile(root, `${at}/${p}`);
    if (bytes !== null) files.push({ path: `${at}/${p}`, bytes });
  }
  return { id, baud, folder: at, files };
}

/** The save's end in a sentence: saved and read back clean, saved with differences, or refused. */
export function saveSaid(o: SaveOutcome): { text: string; bad: boolean } {
  const diffs = o.differences;
  if (o.saved && diffs !== undefined && diffs.length === 0) {
    return {
      text: "Saved. The servo reads back as the run's final set: 0 differences.",
      bad: false,
    };
  }
  if (o.refused !== undefined) return { text: `Not saved: ${o.refused}`, bad: true };
  const n = diffs?.length ?? 0;
  return {
    text: `Saved, but the servo reads back ${String(n)} ${n === 1 ? "difference" : "differences"} from the run's final set.`,
    bad: true,
  };
}
