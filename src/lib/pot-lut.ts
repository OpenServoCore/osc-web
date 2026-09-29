// The pot linearization table (protocol sec 5.7) minus React: the firmware's
// interpolation ported bit for bit, what the table does to the pot's local
// gain interval by interval, and the advisory grade the CLI prints (osc lut
// grade). The firmware judges physics only; quality is the operator's call.

export const GRID_SHIFT = 4;
/** Raw counts per interval. */
export const GRID = 1 << GRID_SHIFT;
/** Host-written knots; knot INTERVALS sits at 4096 and is fixed 0. */
export const INTERVALS = 256;
const ADC_MASK = 4095;
const FRAC_MASK = GRID - 1;

/** `lut_state` values. */
export const STATE = {
  IDENTITY: 0,
  LOADING: 1,
  LIVE: 2,
  REJECT_TORQUE: 3,
  REJECT_ENDS: 4,
  REJECT_SHAPE: 5,
} as const;

/** Local gain is judged over this many raw counts, as nb09 did. */
export const WINDOW = 25;
/** Grade A: every window within this band of nominal. */
export const SMOOTH: readonly [number, number] = [0.5, 2];
/** Grade B: within this band (the SG90 class swings ~6x across 20 mV bins). */
export const COARSE: readonly [number, number] = [0.25, 4];

export type Grade = "A" | "B" | "C";

export function gradeText(grade: Grade): string {
  switch (grade) {
    case "A":
      return "smooth";
    case "B":
      return "coarse track";
    case "C":
      return "suspect";
  }
}

export function gradeOf(min: number, max: number): Grade {
  if (min >= SMOOTH[0] && max <= SMOOTH[1]) return "A";
  if (min >= COARSE[0] && max <= COARSE[1]) return "B";
  return "C";
}

/** The interval a raw sample falls in. */
export function index(raw: number): number {
  return (raw & ADC_MASK) >> GRID_SHIFT;
}

/** The firmware's Q4 word for a raw sample between corrections `c0` and `c1`. */
export function interpQ4(raw: number, c0: number, c1: number): number {
  const r = raw & ADC_MASK;
  const f = r & FRAC_MASK;
  return (((r + c0) << GRID_SHIFT) + (c1 - c0) * f) & 0xffff;
}

/** The Q4 word the kernel computes through `knots` (256 host-written corrections). */
export function q4(knots: readonly number[], raw: number): number {
  const i = index(raw);
  return interpQ4(raw, knots[i] ?? 0, knots[i + 1] ?? 0);
}

/** Linearized counts as the firmware sees them: the Q4 word over GRID. */
export function counts(knots: readonly number[], raw: number): number {
  return q4(knots, raw) / GRID;
}

/** Q4 word to counts, for a TEL `pos_lin` sample. */
export function q4ToCounts(word: number): number {
  return word / GRID;
}

export function isIdentity(knots: readonly number[]): boolean {
  return knots.every((c) => c === 0);
}

/** One interval's gain, x nominal, at the raw count it starts. */
export interface Interval {
  raw: number;
  gain: number;
}

export interface Windows {
  counts: number;
  min: number;
  max: number;
}

export interface Report {
  nonzero: number;
  /** Raw counts from the first nonzero knot to the last. */
  span?: [number, number];
  maxAbs: number;
  steepest?: Interval;
  shallowest?: Interval;
  /** The raw counts the windows ran over. */
  band?: [number, number];
  windows?: Windows;
  grade?: Grade;
  /** Every interval's gain, x nominal. */
  gains: number[];
}

function rawOf(k: number): number {
  return k * GRID;
}

export function report(knots: readonly number[]): Report {
  const k = (i: number) => knots[i] ?? 0;
  const gains = Array.from({ length: INTERVALS }, (_, i) => (GRID + k(i + 1) - k(i)) / GRID);
  const nonzero: number[] = [];
  for (let i = 0; i < INTERVALS; i++) if (k(i) !== 0) nonzero.push(i);
  const r: Report = {
    nonzero: nonzero.length,
    maxAbs: knots.reduce((m, c) => Math.max(m, Math.abs(c)), 0),
    gains,
  };
  const first = nonzero[0];
  const last = nonzero.at(-1);
  if (first === undefined || last === undefined) return r;
  r.span = [rawOf(first), rawOf(last)];
  const band: [number, number] = [Math.max(first - 1, 0), last];
  const at = (i: number): Interval => ({ raw: rawOf(i), gain: gains[i] ?? 1 });
  let steep = at(band[0]);
  let shallow = steep;
  for (let i = band[0]; i <= band[1]; i++) {
    const g = gains[i] ?? 1;
    if (g > steep.gain) steep = at(i);
    if (g < shallow.gain) shallow = at(i);
  }
  r.steepest = steep;
  r.shallowest = shallow;
  const lo = rawOf(band[0]);
  const hi = rawOf(band[1] + 1);
  let min = Infinity;
  let max = -Infinity;
  for (let r0 = lo; r0 <= hi - WINDOW; r0++) {
    const g = (counts(knots, r0 + WINDOW) - counts(knots, r0)) / WINDOW;
    min = Math.min(min, g);
    max = Math.max(max, g);
  }
  r.band = [lo, hi];
  r.windows = { counts: WINDOW, min, max };
  r.grade = gradeOf(min, max);
  return r;
}

/** `lut_state` in words: what the kernel applies and, for a refusal, what to do. */
export function stateWords(state: number): string {
  switch (state) {
    case STATE.IDENTITY:
      return "No table: the pot is read as-is.";
    case STATE.LOADING:
      return "Loading: pages have been written but not committed, so the pot is still read as-is.";
    case STATE.LIVE:
      return "Live: the servo corrects every pot sample through this table.";
    case STATE.REJECT_TORQUE:
      return "Rejected: torque was on when the table was written. Turn torque off and write it again; the pot is read as-is.";
    case STATE.REJECT_ENDS:
      return "Rejected: a correction sits at or past a stop, so the stops would not map to themselves. Rebuild the table against the current stops; the pot is read as-is.";
    case STATE.REJECT_SHAPE:
      return "Rejected: an interval is not increasing or is steeper than 16x, which no pot does. Rebuild it from a fresh capture; the pot is read as-is.";
    default:
      return `Unknown table state ${state}; the pot is read as-is.`;
  }
}

const fmt = (g: number) => `${g.toFixed(2)}x`;

/** The numbers under the graph, one sentence each. */
export function summary(r: Report): string[] {
  const out: string[] = [];
  if (r.span === undefined) {
    out.push("No corrections: every knot is zero.");
    return out;
  }
  out.push(`${r.nonzero} corrections at raw ${r.span[0]}..${r.span[1]}, up to ${r.maxAbs} counts.`);
  if (r.steepest !== undefined && r.shallowest !== undefined) {
    const at = (i: Interval) => `raw ${i.raw}..${i.raw + GRID}`;
    out.push(
      `Steepest interval ${fmt(r.steepest.gain)} at ${at(r.steepest)}, shallowest ${fmt(r.shallowest.gain)} at ${at(r.shallowest)}.`,
    );
  }
  if (r.windows !== undefined && r.band !== undefined) {
    out.push(
      `${r.windows.counts}-count windows over raw ${r.band[0]}..${r.band[1]}: ${fmt(r.windows.min)} to ${fmt(r.windows.max)} of nominal.`,
    );
  }
  return out;
}

/** What each grade means, with the thresholds; advisory, the graph decides. */
export function gradeRule(): string {
  return `A (smooth) has every ${WINDOW}-count window within ${SMOOTH[0]}x..${SMOOTH[1]}x of nominal, B (coarse track) within ${COARSE[0]}x..${COARSE[1]}x, C (suspect) beyond that: a worn track, a slipping seat or a capture artifact. Advisory only; the firmware accepts anything under 16x and the graph decides.`;
}
