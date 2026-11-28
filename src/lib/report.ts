// An identification run's report, read from the run folder osc-ident wrote.
// Every number is one a run file holds, or a unit conversion of one; the
// report passes no judgment of its own, so the words "pass" and "warning"
// appear only where the tool wrote them.

import { withUnit } from "./format";
import { listFiles, readFile, type OpfsDir } from "./opfs";
import { phrase, type RunStep } from "./run-folder";
import { positionDeg, type Calibration } from "./units";

/** The entries `run.json` records, in the order the run takes them. */
export const ORDER = [
  "rest",
  "probe",
  "stops",
  "table",
  "window",
  "spins",
  "gather",
  "tune",
  "cruise",
  "final",
] as const;

/** The files the report reads at once; the captures are read when a graph opens. */
export const REPORT_FILES = [
  "run.json",
  "results/stops.json",
  "results/table.json",
  "results/spins.json",
  "results/cruise.json",
  "inputs/measured.json",
  "inputs/nameplate.json",
  "inputs/resolved.json",
  "inputs/cross-checks.json",
  "inputs/thermal.json",
  "inputs/board.json",
  "final/set.json",
  "final/inputs/pos_lut.json",
  "final/results/verify.json",
] as const;

export type ReportFile = (typeof REPORT_FILES)[number];

export const VERIFY_CAPTURES = "final/captures/verify";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The value at a dotted path, or undefined. */
export function at(doc: unknown, path: string): unknown {
  let v = doc;
  for (const key of path.split(".")) {
    if (!isRecord(v)) return undefined;
    v = v[key];
  }
  return v;
}

export function num(doc: unknown, path: string): number | undefined {
  const v = at(doc, path);
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function str(doc: unknown, path: string): string | undefined {
  const v = at(doc, path);
  return typeof v === "string" ? v : undefined;
}

export function list(doc: unknown, path: string): unknown[] {
  const v = at(doc, path);
  return Array.isArray(v) ? (v as unknown[]) : [];
}

/** A measured quantity as measure writes it: value, spread and unit. */
export interface Term {
  value: number;
  sd: number | null;
  n: number | null;
  unit: string;
}

export function termAt(doc: unknown, path: string): Term | undefined {
  const t = at(doc, path);
  const value = num(t, "value");
  if (value === undefined) return undefined;
  return {
    value,
    sd: num(t, "sd") ?? null,
    n: num(t, "n") ?? null,
    unit: str(t, "unit") ?? "",
  };
}

/** A number as osc-ident prints it: four decimals, or four in exponent form under 0.01. */
export function short(v: number): string {
  return v !== 0 && Math.abs(v) < 0.01 ? v.toExponential(4) : v.toFixed(4);
}

/** A quantity's spread as osc-ident prints it, +/- as the plus-minus sign: `+/- sd, n N`, `n N` where nothing repeated, or `nominal`. */
export function spreadSaid(t: Term): string {
  if (t.sd !== null && t.n !== null) return `± ${short(t.sd)}, n ${String(t.n)}`;
  if (t.n !== null) return `n ${String(t.n)}`;
  return "nominal";
}

/** The value and its unit, as osc-ident prints them with the unit's symbol. */
export function valueSaid(t: Term): string {
  return withUnit(short(t.value), t.unit);
}

/**
 * The free speed at the horn at `volts`: V / Ke in motor rad/s over the gear
 * ratio, in deg/s, the spread through Ke's (gather's cross-check, at any volts).
 */
export function freeSpeed(volts: number, ke: Term, gearRatio: number): Term | undefined {
  if (!(ke.value > 0) || !(gearRatio > 0)) return undefined;
  const value = (volts * 180) / (Math.PI * gearRatio) / ke.value;
  return {
    value,
    sd: ke.sd === null ? null : (value * ke.sd) / ke.value,
    n: ke.n,
    unit: "deg/s",
  };
}

/** The first entry that ended other than accepted: where the run stopped. */
export function stoppedAt(steps: readonly RunStep[]): RunStep | undefined {
  return steps.find((s) => s.state !== "accepted" && s.state !== "not run");
}

/**
 * Why a card cannot show, when one of the entries it reads was not
 * accepted: "The run stopped at the probe." or "The run did not reach the
 * final check."; undefined when every one was.
 */
export function notReached(
  steps: readonly RunStep[],
  needs: readonly string[],
): string | undefined {
  const stop = stoppedAt(steps);
  for (const name of ORDER) {
    if (!needs.includes(name)) continue;
    const s = steps.find((e) => e.name === name);
    if (s?.state === "accepted") continue;
    return s !== undefined && s === stop
      ? `The run stopped at ${phrase(name)}.`
      : `The run did not reach ${phrase(name)}.`;
  }
  return undefined;
}

/** What `run.json` says beyond the steps' states. */
export interface RunTimes {
  /** Seconds from the first entry's start to the last one's end. */
  seconds: number | undefined;
  /** The final set's path in the run folder. */
  setFile: string | undefined;
}

export function runTimes(run: unknown): RunTimes {
  const steps = at(run, "steps");
  const entries: unknown[] = [
    ...(isRecord(steps) ? Object.values(steps) : []),
    ...["gather", "tune", "cruise", "final"].map((n) => at(run, n)),
  ];
  const started = entries.map((e) => num(e, "started")).filter((v) => v !== undefined);
  const ended = entries.map((e) => num(e, "ended")).filter((v) => v !== undefined);
  const seconds =
    started.length === 0 || ended.length === 0
      ? undefined
      : Math.max(...ended) - Math.min(...started);
  return { seconds, setFile: str(run, "final.set_file") };
}

/** "5 min 45 s", or "48 s" under a minute. */
export function durationText(seconds: number): string {
  const s = Math.round(seconds);
  const min = Math.floor(s / 60);
  return min === 0 ? `${String(s)} s` : `${String(min)} min ${String(s % 60)} s`;
}

/** The set's angle map, as the app converts counts to degrees through. */
export function angleMap(set: unknown): Calibration | undefined {
  const field = (n: string) => num(set, `fields.${n}.value`);
  const [rawMin, rawMax, angleMinCdeg, angleMaxCdeg, gear] = [
    field("raw_min"),
    field("raw_max"),
    field("angle_min_cdeg"),
    field("angle_max_cdeg"),
    field("gear_ratio_centi"),
  ];
  if (
    rawMin === undefined ||
    rawMax === undefined ||
    angleMinCdeg === undefined ||
    angleMaxCdeg === undefined ||
    rawMax === rawMin
  ) {
    return undefined;
  }
  return { rawMin, rawMax, angleMinCdeg, angleMaxCdeg, gearRatioCenti: gear ?? 0 };
}

/** The table's 256 points from `pos_lut.json`'s pages. */
export function tablePoints(posLut: unknown): number[] {
  return list(posLut, "points_by_page").flatMap((page) =>
    Array.isArray(page) ? page.map((p) => (typeof p === "number" ? p : 0)) : [],
  );
}

/** The set's 16 wide-code slots, Q4. */
export function wideSlots(set: unknown): number[] {
  return list(set, "wide_codes.slots").map((s) => (typeof s === "number" ? s : 0));
}

const ADC_MASK = 4095;
const WIDE_MASK = 0xff;
const WIDE_SHIFT = 8;
const GRID = 16;
const INTERVALS = 256;

/**
 * Linearized counts as the run's move scores read a raw code (measure's
 * scorecard `Lin::counts`): a wide code as the middle of the span it stands
 * for through the set's slots, then the table's line between its points, in
 * float. Point 256 is the fixed 0.
 */
export function scoreCounts(
  points: readonly number[],
  slots: readonly number[],
  raw: number,
): number {
  const code = raw & ADC_MASK;
  const wide = (code & WIDE_MASK) === WIDE_MASK ? (slots[code >> WIDE_SHIFT] ?? 0) : 0;
  const r = Math.min(code + wide / GRID, ADC_MASK);
  const i = Math.min(Math.floor(r / GRID), INTERVALS - 1);
  const c0 = points[i] ?? 0;
  const c1 = i + 1 < INTERVALS ? (points[i + 1] ?? 0) : 0;
  return r + c0 + ((c1 - c0) * (r - GRID * i)) / GRID;
}

/** A CSV's columns by name; an empty cell is null. */
export type Columns = Map<string, (number | null)[]>;

export function parseCsv(text: string): Columns {
  const lines = text.split("\n").filter((l) => l !== "");
  const names = (lines[0] ?? "").split(",");
  const cols = names.map((): (number | null)[] => []);
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    for (let c = 0; c < cols.length; c++) {
      const cell = cells[c] ?? "";
      cols[c]?.push(cell === "" ? null : Number(cell));
    }
  }
  return new Map(names.map((n, c) => [n, cols[c] ?? []]));
}

export async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A capture's rows (`NN-raw.csv.gz`). */
export async function readRows(bytes: Uint8Array<ArrayBuffer>): Promise<Columns> {
  return parseCsv(new TextDecoder().decode(await gunzip(bytes)));
}

/** The run files the report reads, parsed; a file the folder does not hold is absent. */
export type RunDocs = Map<ReportFile, unknown>;

export function runAt(uid: string, utc: string): string {
  return `${uid}/${utc}`;
}

export async function readDocs(root: OpfsDir, uid: string, utc: string): Promise<RunDocs> {
  const docs: RunDocs = new Map();
  for (const file of REPORT_FILES) {
    const bytes = await readFile(root, `${runAt(uid, utc)}/${file}`);
    if (bytes === null) continue;
    try {
      docs.set(file, JSON.parse(new TextDecoder().decode(bytes)));
    } catch {
      // A file that does not parse reads as one the folder does not hold.
    }
  }
  return docs;
}

/** One verify capture's plan: which move its rows are. */
export interface MoveCapture {
  file: string;
  move: string;
  tickHz: number;
}

/** A self-test's move captures, in file order: the final check's, or those in `folder`. */
export async function moveCaptures(
  root: OpfsDir,
  uid: string,
  utc: string,
  folder: string = VERIFY_CAPTURES,
): Promise<MoveCapture[]> {
  const dir = `${runAt(uid, utc)}/${folder}`;
  const found: MoveCapture[] = [];
  for (const name of await listFiles(root, dir)) {
    if (!name.endsWith(".meta.json")) continue;
    const bytes = await readFile(root, `${dir}/${name}`);
    if (bytes === null) continue;
    let meta: unknown;
    try {
      meta = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      continue;
    }
    const move = str(meta, "plan.move");
    const tickHz = num(meta, "tick_hz");
    if (str(meta, "plan.phase") !== "self-test" || move === undefined || tickHz === undefined) {
      continue;
    }
    found.push({ file: `${dir}/${name.replace(/\.meta\.json$/, ".csv.gz")}`, move, tickHz });
  }
  return found;
}

/** A move's rows in real units on a shared time axis. */
export interface MoveTrace {
  t: number[];
  deg: (number | null)[];
  goal: number[];
  ma: (number | null)[];
}

export interface MoveUnits {
  cal: Calibration;
  points: readonly number[];
  slots: readonly number[];
  currentZeroCounts: number;
  countsPerA: number;
  tickHz: number;
  fromCounts: number;
  goalCounts: number;
}

/**
 * The rows of a move: the raw pot through the run's slots and table into
 * degrees by the set's angle map; the current of rows with a read window,
 * off the final check's zero; the goal stepping from the move's start at
 * the first row.
 */
export function moveTrace(rows: Columns, u: MoveUnits): MoveTrace {
  const ticks = rows.get("tick") ?? [];
  const pos = rows.get("pos") ?? [];
  const raw = rows.get("current_raw") ?? [];
  const valid = rows.get("window_valid") ?? [];
  const t0 = ticks[0] ?? 0;
  const trace: MoveTrace = { t: [], deg: [], goal: [], ma: [] };
  const [from, goal] = [positionDeg(u.fromCounts, u.cal), positionDeg(u.goalCounts, u.cal)];
  for (let i = 0; i < ticks.length; i++) {
    const tick = ticks[i];
    if (tick === null || tick === undefined) continue;
    const p = pos[i];
    const c = raw[i];
    trace.t.push((tick - t0) / u.tickHz);
    trace.deg.push(
      p === null || p === undefined ? null : positionDeg(scoreCounts(u.points, u.slots, p), u.cal),
    );
    trace.goal.push(i === 0 ? from : goal);
    trace.ma.push(
      valid[i] === 1 && c !== null && c !== undefined
        ? ((c - u.currentZeroCounts) / u.countsPerA) * 1000
        : null,
    );
  }
  return trace;
}

/** A raw count for a sentence: whole counts as they are, a fraction to two places. */
export function rawText(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}
