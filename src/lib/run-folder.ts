import { listDirs, listTree, readFile, removeDir, writeFile, type OpfsDir } from "./opfs";
import { readZip, writeZip, type ZipEntry } from "./zip";

/** A run folder's name, osc-ident's `YYYYMMDDTHHMMSSZ`. */
export const UTC_PATTERN = /^\d{8}T\d{6}Z$/;
const UID_PATTERN = /^[0-9a-f]{32}$/;

/** Why a pick is not taken, in words for the user. */
export class RunRefused extends Error {
  override name = "RunRefused";
}

/** One entry of `run.json`: a step, or the gather, tune, cruise or final check after them. */
export interface RunStep {
  name: string;
  state: string;
  why: string | null;
}

export interface Named {
  key: string;
  revision: number | null;
}

/** What a run is, read from its `run.json` (and its `resolved.json` where the gather wrote one). */
export interface RunIdentity {
  uid: string;
  utc: string;
  tool: string | null;
  image: string | null;
  steps: RunStep[];
  /** How far it got: "through the final check", "stopped at the probe". */
  reach: string;
  profile: Named | null;
  policy: Named | null;
}

/** A run folder taken from a pick: its files with paths from the run's own folder. */
export interface PickedRun {
  identity: RunIdentity;
  files: ZipEntry[];
}

/** A run in the browser's storage. */
export interface StoredRun {
  identity: RunIdentity;
  files: number;
  bytes: number;
}

const TITLES: Readonly<Record<string, string>> = {
  rest: "Rest",
  probe: "Probe",
  stops: "Stops",
  table: "Table",
  window: "Window",
  spins: "Spins",
  verify: "Check",
  gather: "Gather",
  tune: "Tune",
  cruise: "Cruise",
  final: "Final check",
};

// Entries `run` adds beside `steps`, in the order it runs them.
const AFTER_STEPS = ["gather", "tune", "cruise", "final"] as const;

export function stepTitle(name: string): string {
  return TITLES[name] ?? name;
}

/** A step as a sentence names it: "the probe", "the rest step". */
export function phrase(name: string): string {
  if (name === "rest") return "the rest step";
  const title = TITLES[name];
  return title === undefined ? `the ${name} step` : `the ${title.toLowerCase()}`;
}

/** The last accepted entry, or the first that ended any other way; "not run" entries are not reached. */
export function reachOf(steps: readonly RunStep[]): string {
  let last: RunStep | undefined;
  for (const s of steps) {
    if (s.state === "not run") break;
    if (s.state !== "accepted") return `stopped at ${phrase(s.name)}`;
    last = s;
  }
  return last === undefined ? "no step recorded" : `through ${phrase(last.name)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parse(bytes: Uint8Array, what: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new RunRefused(`its ${what} is not JSON`);
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** `YYYYMMDDTHHMMSSZ` of a time in Unix seconds, as osc-ident names a run folder. */
export function utcOf(unixSeconds: number): string {
  return new Date(Math.floor(unixSeconds) * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "");
}

/** A run folder's name as the time it gives: "2026-11-27 04:06:24 UTC". */
export function utcText(utc: string): string {
  const at = (from: number, to: number) => utc.slice(from, to);
  return `${at(0, 4)}-${at(4, 6)}-${at(6, 8)} ${at(9, 11)}:${at(11, 13)}:${at(13, 15)} UTC`;
}

/** A size in bytes, kB or MB (powers of 1000, as file managers show them). */
export function sizeText(bytes: number): string {
  if (bytes < 1000) return `${String(bytes)} bytes`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} kB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** The time a run folder's name gives. */
export function dateOfUtc(utc: string): Date {
  const [y, mo, d, h, mi, s] = [0, 4, 6, 9, 11, 13].map((at, i) =>
    Number(utc.slice(at, at + (i === 0 ? 4 : 2))),
  );
  return new Date(Date.UTC(y ?? 0, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0, s ?? 0));
}

interface RunJson {
  uid: string;
  tool: string | null;
  image: string | null;
  steps: RunStep[];
  earliest: number | undefined;
}

export function readRunJson(bytes: Uint8Array): RunJson {
  const doc = parse(bytes, "run.json");
  if (!isRecord(doc)) throw new RunRefused("its run.json is not a run's record");
  const uid = doc.servo_uid;
  if (typeof uid !== "string") throw new RunRefused("its run.json names no servo_uid");
  if (!UID_PATTERN.test(uid)) {
    throw new RunRefused(
      `its run.json names the servo "${uid}", which is not a uid of 32 lowercase hex digits`,
    );
  }
  if (!isRecord(doc.steps)) throw new RunRefused("its run.json lists no steps");
  const entries: [string, unknown][] = Object.entries(doc.steps);
  for (const name of AFTER_STEPS) if (name in doc) entries.push([name, doc[name]]);
  let earliest: number | undefined;
  const steps = entries.map(([name, entry]): RunStep => {
    const e = isRecord(entry) ? entry : {};
    if (typeof e.started === "number" && (earliest === undefined || e.started < earliest)) {
      earliest = e.started;
    }
    return { name, state: text(e.state) ?? "not recorded", why: text(e.why) };
  });
  return { uid, tool: text(doc.tool), image: text(doc.image), steps, earliest };
}

function namedOf(value: unknown): Named | null {
  if (!isRecord(value) || typeof value.key !== "string") return null;
  return { key: value.key, revision: typeof value.revision === "number" ? value.revision : null };
}

export function identityOf(run: RunJson, utc: string, resolved: Uint8Array | null): RunIdentity {
  let report: unknown;
  try {
    report = resolved === null ? null : JSON.parse(new TextDecoder().decode(resolved));
  } catch {
    report = null;
  }
  const r = isRecord(report) ? report : {};
  return {
    uid: run.uid,
    utc,
    tool: run.tool,
    image: run.image,
    steps: run.steps,
    reach: reachOf(run.steps),
    profile: namedOf(r.profile),
    policy: namedOf(r.policy),
  };
}

const RESOLVED = ["inputs/resolved.json", "final/inputs/resolved.json"];

function ignored(path: string): boolean {
  const parts = path.split("/");
  return parts[0] === "__MACOSX" || parts.at(-1) === ".DS_Store";
}

function checkPath(path: string): void {
  const parts = path.split("/");
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    /^[A-Za-z]:/.test(path) ||
    parts.includes("..")
  ) {
    throw new RunRefused(
      `it names a file outside its own folder ("${path}"), so nothing was copied`,
    );
  }
  if (parts.some((p) => p === "" || p === ".")) {
    throw new RunRefused(`it names a file this browser cannot store ("${path}")`);
  }
}

/**
 * The run in a pick's files: the folder holding `run.json`, at the top, one
 * folder down, or under `<uid>/<UTC>/`. Refused, naming why, when the files
 * are not one run folder.
 */
export function locateRun(picked: readonly ZipEntry[]): PickedRun {
  const files = picked.filter((f) => !ignored(f.path));
  if (files.length === 0) throw new RunRefused("it holds no files");
  for (const f of files) checkPath(f.path);
  const records = files.filter((f) => f.path.split("/").at(-1) === "run.json");
  const depth = (f: ZipEntry) => f.path.split("/").length - 1;
  const top = Math.min(...records.map(depth));
  const runs = records.filter((f) => depth(f) === top);
  const first = runs[0];
  if (first === undefined) {
    throw new RunRefused(
      "it holds no run.json, so it is not a run folder: open the <uid>/<UTC>/ folder osc-ident wrote, or a zip of it",
    );
  }
  const dirOf = (f: ZipEntry) => f.path.split("/").slice(0, -1);
  if (runs.length > 1) {
    const names = runs.map((f) => `${dirOf(f).join("/")}/`).join(", ");
    throw new RunRefused(`it holds ${String(runs.length)} runs (${names}): open one run folder`);
  }
  const prefix = dirOf(first);
  if (prefix.length > 2 || (prefix.length === 2 && !UID_PATTERN.test(prefix[0] ?? ""))) {
    throw new RunRefused(
      `its run.json is in ${prefix.join("/")}/, more than one folder down: open that run folder itself`,
    );
  }
  const root = prefix.length === 0 ? "" : `${prefix.join("/")}/`;
  const beside = files.find((f) => !f.path.startsWith(root));
  if (beside !== undefined) {
    throw new RunRefused(
      `it holds files beside the run folder (${beside.path}): open the run folder alone`,
    );
  }
  const run = readRunJson(first.bytes);
  const filedUnder = prefix.length === 2 ? prefix[0] : undefined;
  if (filedUnder !== undefined && filedUnder !== run.uid) {
    throw new RunRefused(
      `it is filed under servo ${filedUnder}, but its run.json names servo ${run.uid}`,
    );
  }
  const named = prefix.at(-1);
  let utc: string;
  if (named !== undefined && UTC_PATTERN.test(named)) utc = named;
  else if (run.earliest !== undefined) utc = utcOf(run.earliest);
  else throw new RunRefused("its folder is not named for a time and its run.json records none");
  const inRun = files.map((f) => ({ path: f.path.slice(root.length), bytes: f.bytes }));
  const resolved = RESOLVED.map((p) => inRun.find((f) => f.path === p)).find(
    (f) => f !== undefined,
  );
  return { identity: identityOf(run, utc, resolved?.bytes ?? null), files: inRun };
}

/** The files of a folder pick (`<input webkitdirectory>`), paths from the folder picked. */
export async function filesOfPick(list: Iterable<File>): Promise<ZipEntry[]> {
  return Promise.all(
    Array.from(list, async (f) => ({
      path: f.webkitRelativePath === "" ? f.name : f.webkitRelativePath,
      bytes: new Uint8Array(await f.arrayBuffer()),
    })),
  );
}

/** The files of a zip, its read errors given as refusals. */
export async function filesOfZip(bytes: Uint8Array<ArrayBuffer>): Promise<ZipEntry[]> {
  try {
    return await readZip(bytes);
  } catch (e) {
    throw new RunRefused(e instanceof Error ? e.message : String(e));
  }
}

function runPath(uid: string, utc: string): string {
  if (!UID_PATTERN.test(uid) || !UTC_PATTERN.test(utc)) {
    throw new Error(`"${uid}/${utc}" is not a run folder`);
  }
  return `${uid}/${utc}`;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function sameRun(root: OpfsDir, at: string, files: readonly ZipEntry[]): Promise<boolean> {
  const stored = await listTree(root, at);
  if (stored.length !== files.length) return false;
  const paths = new Set(stored.map((f) => f.path));
  for (const f of files) {
    if (!paths.has(f.path)) return false;
    const bytes = await readFile(root, `${at}/${f.path}`);
    if (bytes === null || !sameBytes(bytes, f.bytes)) return false;
  }
  return true;
}

/**
 * Copies the run byte for byte to `<uid>/<UTC>/`, as osc-ident's run folder.
 * The same run already there is no error and writes nothing; a different one
 * there is refused. A copy that fails part way is removed.
 */
export async function importRun(
  root: OpfsDir,
  run: PickedRun,
  progress?: (written: number, total: number) => void,
): Promise<"opened" | "already"> {
  const { uid, utc } = run.identity;
  const at = runPath(uid, utc);
  const there = await listTree(root, at);
  if (there.some((f) => f.path === "run.json")) {
    if (await sameRun(root, at, run.files)) return "already";
    throw new RunRefused(`a different run is already in the browser at ${at}/; nothing was copied`);
  }
  // run.json goes last: a folder without it is a copy cut short (a tab closed
  // mid-copy), which the list skips and the next import replaces.
  if (there.length > 0) await removeDir(root, at);
  const ordered = [
    ...run.files.filter((f) => f.path !== "run.json"),
    ...run.files.filter((f) => f.path === "run.json"),
  ];
  try {
    let written = 0;
    for (const f of ordered) {
      await writeFile(root, `${at}/${f.path}`, f.bytes);
      progress?.(++written, run.files.length);
    }
  } catch (e) {
    await removeDir(root, at);
    throw e;
  }
  return "opened";
}

/** Every run in the browser's storage, newest first. */
export async function listRuns(root: OpfsDir): Promise<StoredRun[]> {
  const runs: StoredRun[] = [];
  for (const uid of (await listDirs(root)).filter((n) => UID_PATTERN.test(n))) {
    for (const utc of (await listDirs(root, uid)).filter((n) => UTC_PATTERN.test(n))) {
      const at = runPath(uid, utc);
      const record = await readFile(root, `${at}/run.json`);
      if (record === null) continue;
      const run = readRunJson(record);
      let resolved: Uint8Array | null = null;
      for (const p of RESOLVED) resolved ??= await readFile(root, `${at}/${p}`);
      const tree = await listTree(root, at);
      runs.push({
        identity: identityOf(run, utc, resolved),
        files: tree.length,
        bytes: tree.reduce((n, f) => n + f.size, 0),
      });
    }
  }
  return runs.sort((a, b) => (a.identity.utc < b.identity.utc ? 1 : -1));
}

/** The zip a run downloads as: `<uid>-<UTC>.zip`. */
export function zipName(uid: string, utc: string): string {
  return `${uid}-${utc}.zip`;
}

/** The run as stored, in a zip with one top folder `<UTC>/`; null when it is not there. */
export async function exportRun(
  root: OpfsDir,
  uid: string,
  utc: string,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const at = runPath(uid, utc);
  const tree = await listTree(root, at);
  if (tree.length === 0) return null;
  const entries: ZipEntry[] = [];
  for (const f of tree) {
    const bytes = await readFile(root, `${at}/${f.path}`);
    if (bytes !== null) entries.push({ path: `${utc}/${f.path}`, bytes });
  }
  return writeZip(entries, dateOfUtc(utc));
}
