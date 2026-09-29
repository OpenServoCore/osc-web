// The pot linearization table (protocol sec 5.7) minus React: the firmware's
// interpolation ported bit for bit, the sensor error the table removes at each
// position, and the advisory grade the CLI prints (osc lut grade). The
// firmware judges physics only; quality is the operator's call.

import { ADC_FULL_SCALE, ADC_MAX_COUNT, degPerCount, positionDeg, type Calibration } from "./units";

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
  /** The raw counts the table changes a reading in, and the windows ran over. */
  band?: [number, number];
  windows?: Windows;
  grade?: Grade;
}

function rawOf(k: number): number {
  return k * GRID;
}

export function report(knots: readonly number[]): Report {
  const nonzero: number[] = [];
  for (let i = 0; i < INTERVALS; i++) if ((knots[i] ?? 0) !== 0) nonzero.push(i);
  const r: Report = {
    nonzero: nonzero.length,
    maxAbs: knots.reduce((m, c) => Math.max(m, Math.abs(c)), 0),
  };
  const first = nonzero[0];
  const last = nonzero.at(-1);
  if (first === undefined || last === undefined) return r;
  r.span = [rawOf(first), rawOf(last)];
  const band: [number, number] = [Math.max(first - 1, 0), last];
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
      return "No table: the sensor is read as-is.";
    case STATE.LOADING:
      return "Loading: pages have been written but not committed, so the sensor is still read as-is.";
    case STATE.LIVE:
      return "Live: the servo corrects every sensor sample through this table.";
    case STATE.REJECT_TORQUE:
      return "Rejected: torque was on when the table was written. Turn torque off and write it again; the sensor is read as-is.";
    case STATE.REJECT_ENDS:
      return "Rejected: a calibration point sits at or past a stop, so the stops would not map to themselves. Rebuild the table against the current stops; the sensor is read as-is.";
    case STATE.REJECT_SHAPE:
      return "Rejected: an interval is not increasing or is steeper than 16x, which no sensor does. Rebuild it from a fresh capture; the sensor is read as-is.";
    default:
      return `Unknown table state ${state}; the sensor is read as-is.`;
  }
}

/** The unit the card shows positions and errors in: degrees through a valid angle map, else counts. */
export type Unit = "deg" | "counts";

/** The sensor error the table removes, position by position, in the card's units. */
export interface ErrorSeries {
  unit: Unit;
  /** Horn angle in deg through the map, or the raw count without one; the whole travel. */
  x: number[];
  /** Raw minus compensated at that position, in `unit`: what the sensor reads minus the true position. */
  y: number[];
  /** Percent of travel (of the 12-bit range without a map) per unit of `y`. */
  pctPerUnit: number;
  /** The largest |y|. */
  maxAbs: number;
  /** In `x`: where the table changes a reading; the identity elsewhere. */
  band?: [number, number];
}

/**
 * The error curve over the calibrated travel, raw count by raw count. `cal` is
 * the angle map the app shows real units through; without one the axes stay
 * in counts and percent is of the converter's full scale.
 */
export function errorSeries(knots: readonly number[], cal: Calibration | undefined): ErrorSeries {
  const r = report(knots);
  const scale = cal === undefined ? 1 : degPerCount(cal);
  const toX = (raw: number) => (cal === undefined ? raw : positionDeg(raw, cal));
  const [lo, hi] = cal === undefined ? [0, ADC_MAX_COUNT] : [cal.rawMin, cal.rawMax];
  const x: number[] = [];
  const y: number[] = [];
  let maxAbs = 0;
  for (let raw = lo; raw <= hi; raw++) {
    const e = (raw - counts(knots, raw)) * scale;
    x.push(toX(raw));
    y.push(e);
    maxAbs = Math.max(maxAbs, Math.abs(e));
  }
  if (scale < 0) {
    x.reverse();
    y.reverse();
  }
  const travel =
    cal === undefined ? ADC_FULL_SCALE : Math.abs(cal.angleMaxCdeg - cal.angleMinCdeg) / 100;
  const s: ErrorSeries = {
    unit: cal === undefined ? "counts" : "deg",
    x,
    y,
    pctPerUnit: travel === 0 ? 0 : 100 / travel,
    maxAbs,
  };
  if (r.band !== undefined) {
    const [a, b] = [toX(r.band[0]), toX(r.band[1])];
    s.band = [Math.min(a, b), Math.max(a, b)];
  }
  return s;
}

function fmtValue(v: number, unit: Unit): string {
  return unit === "deg" ? `${v.toFixed(1)} deg` : `${v.toFixed(0)} counts`;
}

/** An error of `abs` in the series' unit as percent of travel, or of the converter's range. */
function fmtPct(abs: number, s: ErrorSeries): string {
  return `${(abs * s.pctPerUnit).toFixed(1)}% of ${s.unit === "deg" ? "travel" : "its range"}`;
}

/** The sentence above the graph: the worst of the error, in both units. */
export function headline(s: ErrorSeries): string {
  return `The sensor reads up to ${fmtValue(s.maxAbs, s.unit)} (${fmtPct(s.maxAbs, s)}) off; this table corrects it.`;
}

/** The readout for the point under the cursor: the position and which way the sensor reads there. */
export function hoverWords(s: ErrorSeries, i: number): string {
  const x = s.x[i];
  const y = s.y[i];
  if (x === undefined || y === undefined) return "";
  const at = s.unit === "deg" ? fmtValue(x, "deg") : `raw ${x} counts`;
  const abs = Math.abs(y);
  if (Number(abs.toFixed(s.unit === "deg" ? 1 : 0)) === 0) return `${at}: on target`;
  return `${at}: reads ${y < 0 ? "low" : "high"} by ${fmtValue(abs, s.unit)} (${fmtPct(abs, s)})`;
}

/** How many calibration points the table holds and the positions they cover. */
export function pointsWords(r: Report, cal: Calibration | undefined): string {
  if (r.span === undefined) return "No calibration points: the table is all zeros.";
  const at = (raw: number) =>
    cal === undefined ? `raw ${raw} counts` : fmtValue(positionDeg(raw, cal), "deg");
  return `${r.nonzero} calibration points between ${at(r.span[0])} and ${at(r.span[1])}.`;
}

/** What each grade means, with the thresholds; advisory, the graph decides. */
export function gradeRule(): string {
  return `A (smooth) has every ${WINDOW}-count window within ${SMOOTH[0]}x..${SMOOTH[1]}x of nominal, B (coarse track) within ${COARSE[0]}x..${COARSE[1]}x, C (suspect) beyond that: a worn track, a slipping seat or a capture artifact. Advisory only; the firmware accepts anything under 16x and the graph decides.`;
}
