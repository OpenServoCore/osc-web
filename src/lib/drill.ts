// A step's drill-in: its results file as written, as tables and point sets.
// Every value is one the file holds or a unit conversion of one; the drill-in
// fits nothing and judges nothing, and the tool's checks show word for word.

import { unitSymbol } from "./format";
import { at, list, num, short, spreadSaid, str, termAt, valueSaid, type Term } from "./report";
import type { Point } from "./report-cards";

/** The steps with a drill-in, in the order the run takes them. */
export const DRILL_STEPS = [
  "rest",
  "probe",
  "stops",
  "table",
  "window",
  "spins",
  "tune",
  "cruise",
  "final",
] as const;

export type DrillStep = (typeof DRILL_STEPS)[number];

export function isDrillStep(name: string): name is DrillStep {
  return (DRILL_STEPS as readonly string[]).includes(name);
}

/** The file a step writes its results to, from the run folder. */
export function resultsFile(step: DrillStep): string {
  if (step === "tune") return "tune/tune.json";
  if (step === "final") return "final/results/verify.json";
  return `results/${step}.json`;
}

/** The folder a step's captures are in; the tune's are per try. */
export function capturesDir(step: DrillStep): string {
  return step === "final" ? "final/captures/verify" : `captures/${step}`;
}

export function tryDir(n: number): string {
  return `tune/tries/${String(n).padStart(2, "0")}`;
}

/** A value for a table cell: integers whole, other numbers as osc-ident prints them, the rest as written. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : short(v);
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) return v.map(cellText).join(", ");
  return JSON.stringify(v);
}

export interface EstimateRow {
  name: string;
  value: string;
  sd: string;
  n: string;
  unit: string;
  source: string;
}

/** The step's `estimates`, in file order; one written as null says so. */
export function estimateRows(doc: unknown): EstimateRow[] {
  const estimates = at(doc, "estimates");
  if (typeof estimates !== "object" || estimates === null) return [];
  return Object.entries(estimates).map(([name, e]): EstimateRow => {
    const t = termAt(estimates, name);
    if (t === undefined) {
      return {
        name,
        value: "none written",
        sd: "",
        n: "",
        unit: "",
        source: str(e, "source") ?? "",
      };
    }
    return {
      name,
      value: short(t.value),
      sd: t.sd === null ? "" : `± ${short(t.sd)}`,
      n: t.n === null ? "" : String(t.n),
      unit: unitSymbol(t.unit),
      source: str(e, "source") ?? "",
    };
  });
}

export interface CheckRow {
  name: string;
  value: string;
  bound: string;
  verdict: string;
}

/** The tool's checks, word for word. */
export function checkRows(doc: unknown, path = "checks"): CheckRow[] {
  return list(doc, path).map((c) => ({
    name: cellText(at(c, "name")),
    value: cellText(at(c, "value")),
    bound: cellText(at(c, "bound")),
    verdict: cellText(at(c, "verdict")),
  }));
}

export interface KeyLine {
  key: string;
  value: string;
}

/** An object's keys and values as lines, nested keys dotted. */
export function keyLines(obj: unknown, prefix = ""): KeyLine[] {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return [];
  return Object.entries(obj).flatMap(([k, v]): KeyLine[] => {
    const key = prefix === "" ? k : `${prefix}.${k}`;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) return keyLines(v, key);
    return [{ key, value: cellText(v) }];
  });
}

/** A step's capture: its meta file, the rows file beside it, and whether the folder holds the rows. */
export interface CaptureEntry {
  name: string;
  meta: string | undefined;
  rows: string;
  kept: boolean;
}

// measure names a shunt burst `burst-N.csv`, every other capture `NN-<row>.csv.gz`.
function rowsName(base: string): string {
  return base.startsWith("burst-") ? `${base}.csv` : `${base}.csv.gz`;
}

/** The captures in a folder from its file names, in capture order; a rows file with no meta is listed too. */
export function captureEntries(dir: string, names: readonly string[]): CaptureEntry[] {
  const have = new Set(names);
  const entries: CaptureEntry[] = [];
  const claimed = new Set<string>();
  for (const n of names) {
    if (!n.endsWith(".meta.json")) continue;
    const base = n.slice(0, -".meta.json".length);
    const rows = [`${base}.csv.gz`, `${base}.csv`].find((r) => have.has(r)) ?? rowsName(base);
    claimed.add(rows);
    entries.push({ name: base, meta: `${dir}/${n}`, rows: `${dir}/${rows}`, kept: have.has(rows) });
  }
  for (const n of names) {
    if (claimed.has(n) || !(n.endsWith(".csv") || n.endsWith(".csv.gz"))) continue;
    entries.push({
      name: n.replace(/\.csv(\.gz)?$/, ""),
      meta: undefined,
      rows: `${dir}/${n}`,
      kept: true,
    });
  }
  const order = (e: CaptureEntry) => {
    const m = /(\d+)/.exec(e.name);
    return m === null ? Number.MAX_SAFE_INTEGER : Number(m[1]);
  };
  return entries.sort((a, b) =>
    a.name.startsWith("burst-") === b.name.startsWith("burst-")
      ? order(a) - order(b) || (a.name < b.name ? -1 : 1)
      : a.name.startsWith("burst-")
        ? 1
        : -1,
  );
}

/** The sentence a capture trimmed out of the folder carries. */
export function trimmedText(e: CaptureEntry): string {
  const meta = e.meta === undefined ? "" : `; its ${e.meta.slice(e.meta.lastIndexOf("/") + 1)} is`;
  return `Trimmed: the run folder does not hold ${e.rows}${meta}.`;
}

/** What a capture was, from its meta's plan: "rung 2 (pass 1 down, free), drive + coast". */
export function planText(meta: unknown): string {
  const plan = at(meta, "plan");
  const name =
    str(plan, "rung") ??
    str(plan, "spin") ??
    str(plan, "move") ??
    (str(plan, "phase") === undefined
      ? undefined
      : `${str(plan, "phase") ?? ""}${num(plan, "leg") === undefined ? "" : ` leg ${String(num(plan, "leg"))}`}`);
  const parts = list(plan, "parts").filter((p) => typeof p === "string");
  const rows = num(meta, "rows") ?? num(meta, "samples");
  const words = [
    name,
    parts.length > 0 ? parts.join(" + ") : undefined,
    rows === undefined
      ? undefined
      : `${String(rows)} ${num(meta, "rows") === undefined ? "samples" : "rows"}`,
  ].filter((w) => w !== undefined && w !== "");
  return words.join(", ");
}

export interface Preview {
  header: string[];
  rows: string[][];
  total: number;
}

/** A CSV's first rows as text cells, and how many rows it holds. */
export function csvPreview(text: string, limit: number): Preview {
  const lines = text.split("\n").filter((l) => l !== "");
  return {
    header: (lines[0] ?? "").split(","),
    rows: lines.slice(1, limit + 1).map((l) => l.split(",")),
    total: Math.max(lines.length - 1, 0),
  };
}

/** A capture's columns as a series against time (`tick`, `t_s`) or the first column. */
export function captureSeries(
  cols: Map<string, (number | null)[]>,
  column: string,
  tickHz: number | undefined,
): { x: number[]; y: (number | null)[]; xLabel: string } {
  const finite = (v: number | null | undefined) =>
    v === null || v === undefined || !Number.isFinite(v) ? null : v;
  const ys = cols.get(column) ?? [];
  const pick = (name: string, scale: number, label: string) => {
    const raw = cols.get(name) ?? [];
    const x0 = finite(raw.find((v) => finite(v) !== null)) ?? 0;
    const x: number[] = [];
    const y: (number | null)[] = [];
    raw.forEach((v, i) => {
      const fx = finite(v);
      if (fx === null) return;
      x.push((fx - x0) * scale);
      y.push(finite(ys[i]));
    });
    return { x, y, xLabel: label };
  };
  if (cols.has("tick") && tickHz !== undefined && tickHz > 0) {
    return pick("tick", 1 / tickHz, "time, s");
  }
  if (cols.has("t_s")) return pick("t_s", 1, "time, s");
  const first = [...cols.keys()][0] ?? "";
  return pick(first, 1, first);
}

/** How often each whole value occurs, in value order. */
export function histogram(values: readonly (number | null)[]): Point[] {
  const counts = new Map<number, number>();
  for (const v of values) {
    if (v === null || !Number.isFinite(v)) continue;
    const k = Math.round(v);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([x, y]) => ({ x, y }));
}

/** A horizontal line across the x of `sets`. */
export function level(y: number, sets: readonly (readonly Point[])[]): Point[] {
  const xs = sets.flatMap((s) => s.map((p) => p.x));
  if (xs.length === 0) return [];
  return [
    { x: Math.min(...xs), y },
    { x: Math.max(...xs), y },
  ];
}

/** Points of `rows` at x, y paths (y times `scale`), split by a flag path: [flag true, flag false]. */
export function pointsBy(
  rows: readonly unknown[],
  x: string | ((r: unknown, i: number) => number | undefined),
  y: string,
  flag: string,
  scale = 1,
): [Point[], Point[]] {
  const yes: Point[] = [];
  const no: Point[] = [];
  rows.forEach((r, i) => {
    const xv = typeof x === "string" ? num(r, x) : x(r, i);
    const yv = num(r, y);
    if (xv === undefined || yv === undefined) return;
    (at(r, flag) === true ? yes : no).push({ x: xv, y: yv * scale });
  });
  return [yes, no];
}

/** A mean with lines at +/- one sd across the x of `sets`. */
export function meanBand(
  mean: number,
  sd: number | null,
  sets: readonly (readonly Point[])[],
): { mean: Point[]; lo: Point[]; hi: Point[] } {
  return {
    mean: level(mean, sets),
    lo: sd === null ? [] : level(mean - sd, sets),
    hi: sd === null ? [] : level(mean + sd, sets),
  };
}

/** One try of the tune or of its back-off, from `tune.json` or `back-off.json`. */
export interface TryRow {
  n: number;
  from: "tune" | "back-off";
  kp: string;
  shareOfStart: string;
  vKp: string;
  verdict: string;
  failedOn: string;
  why: string;
  next: string;
  after: string;
  restErrorDeg: number | undefined;
  overshootShare: number | undefined;
  followPeakCounts: number | undefined;
}

function tryRows(doc: unknown, from: TryRow["from"]): TryRow[] {
  return list(doc, "tries").flatMap((t): TryRow[] => {
    const n = num(t, "try");
    if (n === undefined) return [];
    return [
      {
        n,
        from,
        kp: cellText(at(t, "kp")),
        shareOfStart: cellText(at(t, "share_of_start")),
        vKp: cellText(at(t, "v_kp_q88")),
        verdict: cellText(at(t, "verdict")),
        failedOn: cellText(at(t, "failed_on")),
        why: cellText(at(t, "why")),
        next: cellText(at(t, "next")),
        after: cellText(at(t, "after")),
        restErrorDeg: num(t, "worst.rest_error_deg"),
        overshootShare: num(t, "worst.overshoot_share_of_bound"),
        followPeakCounts: num(t, "worst.follow_peak_counts"),
      },
    ];
  });
}

/** Every try in run order: the tune's, then the back-off's after the final check refused. */
export function tries(tune: unknown, backOff: unknown): TryRow[] {
  return [...tryRows(tune, "tune"), ...tryRows(backOff, "back-off")];
}

/** The try the run ended on: the back-off's accepted try when it ran, else the tune's. */
export function acceptedTry(tune: unknown, backOff: unknown): number | undefined {
  return num(backOff, "accepted.try") ?? num(tune, "accepted.try");
}

/** A term with its spread as one phrase: 4.0988 ohm +/- 0.0446, n 36, with the symbols. */
export function termText(t: Term | undefined): string {
  if (t === undefined) return "none written";
  return `${valueSaid(t)} ${spreadSaid(t)}`;
}

/**
 * Point sets on one x axis for a scatter: every point keeps its own x slot,
 * so points that share an x stay apart; each set is null off its own points.
 */
export function scatter(sets: readonly (readonly Point[])[]): [number[], ...(number | null)[][]] {
  const all = sets
    .flatMap((s, k) => s.map((p) => ({ ...p, k })))
    .sort((a, b) => a.x - b.x || a.k - b.k);
  const ys = sets.map((_, k) => all.map((p) => (p.k === k ? p.y : null)));
  return [all.map((p) => p.x), ...ys];
}
