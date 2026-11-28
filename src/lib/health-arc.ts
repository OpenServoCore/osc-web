// The position sensor's health arc (the report's travel map): the travel as an
// arc of its own degrees, with the position holes and the converter's wide
// codes the table step listed, and the table's local slope as the shade of
// good travel. Every angle is a raw code through the run's table and the set's
// angle map, so a mark's drawn length is in proportion to the whole travel.

import { counts, GRID, INTERVALS, WINDOW } from "./pos-lut";
import {
  angleMap,
  at,
  list,
  notReached,
  num,
  rawText,
  str,
  tablePoints,
  wideSlots,
  type RunDocs,
} from "./report";
import type { Card } from "./report-cards";
import type { RunStep } from "./run-folder";
import { positionDeg, type Calibration } from "./units";

/** The band's mid radius, in the arc's own units (px at its natural size). */
export const R = 190;
/** Ring radii over R: [inner, outer]. */
export const RINGS = {
  band: [0.93, 1.07],
  adc: [1.09, 1.17],
  pot: [0.85, 0.93],
  scale: [0.89, 0.93],
} as const;
export const LABEL_R = 1.26;
/** Every hole and tick is drawn at least this wide at its radius. */
export const MIN_PX = 2;
/** The pane follows the nearest mark within this distance of the pointer. */
export const HIT_PX = 8;
/** The shade's fixed domain: log2 of counts a degree over the average, -1 to +1. */
const SHADE_LIMIT = 1;
const ADC_MASK = 4095;
const WIDE_SHIFT = 8;
const SLOT_Q = 16;
const TABLE_ROW_EVERY_DEG = 10;

export type MarkKind = "good" | "pot" | "adc" | "not judged";

interface MarkBase {
  /** Index in angle order, the keyboard's and the table's key. */
  key: string;
  fromDeg: number;
  toDeg: number;
  fromRaw: number;
  toRaw: number;
  counts: number;
}

export interface Good extends MarkBase {
  kind: "good";
  /** Raw counts a degree here over the travel's average. */
  q: number;
  /** The table's local gain: linearized counts a raw count over the window. */
  gain: number;
  countsPerDeg: number;
}

export interface PotHole extends MarkBase {
  kind: "pot";
  /** The tool's size in degrees. */
  deg: number;
  cycles: number | undefined;
  shaftDeg: number | undefined;
  rMax: number | undefined;
  passes: number[];
  dirs: number[];
}

export interface AdcCode extends MarkBase {
  kind: "adc";
  carry: number;
  /** The set's slot for this carry, Q4; 0 where none is stored. */
  slot: number;
  /** The tool's size in degrees. */
  deg: number;
}

export interface Unjudged extends MarkBase {
  kind: "not judged";
  why: "uncrossed" | "turn";
}

export type Mark = Good | PotHole | AdcCode | Unjudged;

/** Codes never read that do not start just above a carry: a piece of a pot stretch, not drawn as a tick. */
export interface OffCarry {
  fromRaw: number;
  toRaw: number;
  counts: number;
  fromDeg: number;
  toDeg: number;
}

export interface Arc {
  travelDeg: number;
  /**
   * The angle map's degrees at the CW stop. Marks sit in degrees of travel
   * from that stop; this added gives the servo's own, 0 at its center.
   */
  cwDeg: number;
  /** Raw counts a degree over the whole travel. */
  avgCountsPerDeg: number;
  good: Good[];
  pot: PotHole[];
  adc: AdcCode[];
  unjudged: Unjudged[];
  offCarry: OffCarry[];
  /** The marks the keyboard steps through and the table lists, in angle order. */
  stops: Mark[];
  /** Good travel at every 10 deg, the table's resolution rows. */
  resolution: Good[];
  longestPot: PotHole | undefined;
  widestAdc: AdcCode | undefined;
  /** Counts a degree over the average across the middle 90 % of the judged travel. */
  spread: [number, number] | undefined;
  edgeMarginCounts: number;
  potRule: PotRule;
  notRead: { rungs: number[]; why: string }[];
  potSource: string | undefined;
  adcSource: string | undefined;
}

/** The pot hole rule's own numbers from the holes block. */
export interface PotRule {
  /** Each pass's median pot counts a ripple cycle, lowest and highest. */
  perCycle: [number, number] | undefined;
  s: number | undefined;
  line: number | undefined;
  farK: number | undefined;
}

/** Screen angle in deg, math convention: the arc centered at 12 o'clock, the CW stop on the right. */
export function phiOf(theta: number, travelDeg: number): number {
  return 90 - travelDeg / 2 + theta;
}

/** SVG coordinates of a point at radius `r` and screen angle `phi` (y down). */
export function point(r: number, phi: number): { x: number; y: number } {
  const a = (phi * Math.PI) / 180;
  return { x: r * Math.cos(a), y: -r * Math.sin(a) };
}

/** A mark's drawn span in deg: its true span, widened about its middle to MIN_PX at radius `r`. */
export function drawnSpan(fromDeg: number, toDeg: number, r: number): [number, number] {
  const min = ((MIN_PX / r) * 180) / Math.PI;
  const w = toDeg - fromDeg;
  if (w >= min) return [fromDeg, toDeg];
  const mid = (fromDeg + toDeg) / 2;
  return [mid - min / 2, mid + min / 2];
}

function f(v: number): string {
  return v.toFixed(2);
}

/** The SVG path of the ring sector from `a` to `b` deg of travel, between radii r0 and r1. */
export function sectorPath(
  a: number,
  b: number,
  r0: number,
  r1: number,
  travelDeg: number,
): string {
  const [p0, p1] = [phiOf(a, travelDeg), phiOf(b, travelDeg)];
  const large = p1 - p0 > 180 ? 1 : 0;
  const o0 = point(r1, p0);
  const o1 = point(r1, p1);
  const i1 = point(r0, p1);
  const i0 = point(r0, p0);
  return [
    `M${f(o0.x)} ${f(o0.y)}`,
    `A${f(r1)} ${f(r1)} 0 ${large} 0 ${f(o1.x)} ${f(o1.y)}`,
    `L${f(i1.x)} ${f(i1.y)}`,
    `A${f(r0)} ${f(r0)} 0 ${large} 1 ${f(i0.x)} ${f(i0.y)}`,
    "Z",
  ].join(" ");
}

/** The radii a mark is drawn and hit between. */
export function ringOf(kind: MarkKind): [number, number] {
  if (kind === "adc") return [RINGS.adc[0] * R, RINGS.adc[1] * R];
  if (kind === "pot") return [RINGS.pot[0] * R, RINGS.band[1] * R];
  return [RINGS.band[0] * R, RINGS.band[1] * R];
}

/** The mark's drawn span: holes and ticks at least MIN_PX at their middle radius. */
export function spanOf(m: Mark): [number, number] {
  if (m.kind === "good" || m.kind === "not judged") return [m.fromDeg, m.toDeg];
  const [r0, r1] = ringOf(m.kind);
  return drawnSpan(m.fromDeg, m.toDeg, (r0 + r1) / 2);
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const LABEL_HALF_W = 24;
const END_LABEL_HALF_W = 52;
const END_GAP_DEG = 6;
const READOUT_TOP = -0.62 * R;
const READOUT_BOTTOM = 0.2 * R;
const READOUT_HALF_W = 0.82 * R;
const PAD = 8;

/** Where a stop's label sits: just past the end of the arc, below its last mark. */
export function endLabelAt(end: "cw" | "ccw", travelDeg: number): { x: number; y: number } {
  const theta = end === "cw" ? -END_GAP_DEG : travelDeg + END_GAP_DEG;
  return point(R, phiOf(theta, travelDeg));
}

/**
 * The arc's own bounding box plus its labels and the center readout, so a
 * short travel does not sit in empty space: both ends, the top, and the sides
 * once the travel passes them.
 */
export function frame(travelDeg: number): Box {
  const [p0, p1] = [phiOf(0, travelDeg), phiOf(travelDeg, travelDeg)];
  const angles = [p0, p1];
  for (let a = -360; a <= 360; a += 90) if (a > p0 && a < p1) angles.push(a);
  const pts: { x: number; y: number }[] = [];
  const outer = LABEL_R * R + LABEL_HALF_W;
  for (const a of angles) pts.push(point(outer, a), point(RINGS.pot[0] * R, a));
  for (const end of ["cw", "ccw"] as const) {
    const p = endLabelAt(end, travelDeg);
    pts.push({ x: p.x - END_LABEL_HALF_W, y: p.y }, { x: p.x + END_LABEL_HALF_W, y: p.y + 18 });
  }
  pts.push({ x: -READOUT_HALF_W, y: READOUT_TOP }, { x: READOUT_HALF_W, y: READOUT_BOTTOM });
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs) - PAD;
  const y = Math.min(...ys) - PAD;
  return { x, y, w: Math.max(...xs) + PAD - x, h: Math.max(...ys) + PAD - y };
}

/**
 * Degree ticks in the angle map's degrees, the CW stop at `cwDeg`: every 30
 * deg, 45 over 200 deg of travel, none too near a stop's own label.
 */
export function scaleTicks(travelDeg: number, cwDeg: number): number[] {
  const step = travelDeg > 200 ? 45 : 30;
  const out: number[] = [];
  for (
    let d = Math.ceil((cwDeg + step / 3) / step) * step;
    d < cwDeg + travelDeg - step / 3;
    d += step
  ) {
    out.push(d);
  }
  return out;
}

/** Travel deg under SVG point (x, y): 0 to 360 from the CW stop, counterclockwise. */
function thetaUnder(x: number, y: number, travelDeg: number): number {
  const phi = (Math.atan2(-y, x) * 180) / Math.PI;
  return (((phi - phiOf(0, travelDeg)) % 360) + 360) % 360;
}

/** Distance from SVG point (x, y) to a ring sector, in the arc's units. */
export function distanceTo(
  x: number,
  y: number,
  span: [number, number],
  ring: [number, number],
  travelDeg: number,
): number {
  const rho = Math.hypot(x, y);
  const t = thetaUnder(x, y, travelDeg);
  const [a, b] = span;
  const around = (d: number) => Math.min(Math.abs(d), 360 - Math.abs(d));
  const dTheta = t >= a && t <= b ? 0 : Math.min(around(t - a), around(t - b));
  const dArc = (rho * dTheta * Math.PI) / 180;
  const dR = Math.max(ring[0] - rho, 0, rho - ring[1]);
  return Math.hypot(dArc, dR);
}

/**
 * The mark the pane follows at SVG point (x, y): the nearest hole or tick
 * within `reach`, so a 2 px hole stays hittable over the band; else the band
 * under the point.
 */
export function markAt(arc: Arc, x: number, y: number, reach: number): Mark | undefined {
  const nearest = (marks: readonly Mark[]) => {
    let best: { m: Mark; d: number } | undefined;
    for (const m of marks) {
      const d = distanceTo(x, y, spanOf(m), ringOf(m.kind), arc.travelDeg);
      if (d <= reach && (best === undefined || d < best.d)) best = { m, d };
    }
    return best?.m;
  };
  return nearest([...arc.pot, ...arc.adc]) ?? nearest([...arc.unjudged, ...arc.good]);
}

/** The mark's middle on the band's outer edge, where the keyboard anchors the pane. */
export function anchorOf(m: Mark, travelDeg: number): { x: number; y: number } {
  const [r0, r1] = ringOf(m.kind);
  return point(
    m.kind === "pot" ? RINGS.band[1] * R : (r0 + r1) / 2,
    phiOf((m.fromDeg + m.toDeg) / 2, travelDeg),
  );
}

/** The shade's place for counts a degree `q` times the average: -1 coarse (0.5x), 0 the average, +1 fine (2x). */
export function shadeOf(q: number): number {
  if (!(q > 0)) return -SHADE_LIMIT;
  return Math.min(SHADE_LIMIT, Math.max(-SHADE_LIMIT, Math.log2(q)));
}

/** The good-travel fill for shade `t`: OKLCH between the three ramp steps. */
export function fillOf(t: number): string {
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  return t <= 0
    ? `color-mix(in oklch, var(--color-pos-coarse), var(--color-pos-typical) ${pct(1 + t)})`
    : `color-mix(in oklch, var(--color-pos-typical), var(--color-pos-fine) ${pct(t)})`;
}

/** Horn degrees from the CW stop of a raw code, a fraction between its neighbors' degrees. */
export function thetaAt(raw: number, points: readonly number[], cal: Calibration): number {
  const cw = Math.min(cal.angleMinCdeg, cal.angleMaxCdeg) / 100;
  const deg = (r: number) => positionDeg(counts(points, r), cal) - cw;
  const lo = Math.floor(raw);
  return lo === raw ? deg(raw) : deg(lo) + (deg(lo + 1) - deg(lo)) * (raw - lo);
}

/** The table's linearized counts a raw count over WINDOW counts centered on interval `k`. */
export function gainAt(points: readonly number[], k: number): number {
  const r0 = Math.min(Math.max(k * GRID + GRID / 2 - Math.floor(WINDOW / 2), 0), ADC_MASK - WINDOW);
  return (counts(points, r0 + WINDOW) - counts(points, r0)) / WINDOW;
}

/** The q at the 5th and 95th percent of the judged travel's degrees. */
function middle90(good: readonly Good[]): [number, number] | undefined {
  const sorted = [...good].sort((a, b) => a.q - b.q);
  const total = sorted.reduce((s, g) => s + (g.toDeg - g.fromDeg), 0);
  if (sorted.length === 0 || total <= 0) return undefined;
  const at0 = (frac: number) => {
    let acc = 0;
    for (const g of sorted) {
      acc += g.toDeg - g.fromDeg;
      if (acc >= frac * total) return g.q;
    }
    return sorted[sorted.length - 1]?.q ?? 0;
  };
  return [at0(0.05), at0(0.95)];
}

function nums(v: unknown, path: string): number[] {
  return list(v, path).filter((x): x is number => typeof x === "number");
}

function groupNotRead(entries: readonly unknown[]): { rungs: number[]; why: string }[] {
  const out: { rungs: number[]; why: string }[] = [];
  for (const e of entries) {
    const rung = num(e, "rung");
    const why = str(e, "why") ?? "";
    if (rung === undefined) continue;
    const g = out.find((o) => o.why === why);
    if (g === undefined) out.push({ rungs: [rung], why });
    else g.rungs.push(rung);
  }
  return out;
}

function lacks(file: string): string {
  return `The run folder holds no ${file}.`;
}

export function healthArc(docs: RunDocs, steps: readonly RunStep[]): Card<Arc> {
  const why = notReached(steps, ["table", "final"]);
  if (why !== undefined) return { why };
  const made = buildArc(docs);
  return typeof made === "string" ? { why: made } : { data: made };
}

function buildArc(docs: RunDocs): Arc | string {
  const set = docs.get("final/set.json");
  const cal = angleMap(set);
  const points = tablePoints(docs.get("final/inputs/pos_lut.json"));
  const holes = at(docs.get("results/table.json"), "holes");
  if (cal === undefined) return lacks("final/set.json angle map");
  if (points.length !== INTERVALS) return lacks("final/inputs/pos_lut.json points");
  if (holes === undefined) return lacks("results/table.json holes");
  const travelDeg = Math.abs(cal.angleMaxCdeg - cal.angleMinCdeg) / 100;
  const cwDeg = Math.min(cal.angleMinCdeg, cal.angleMaxCdeg) / 100;
  if (!(travelDeg > 0) || travelDeg > 360) {
    return `The angle map spans ${travelDeg.toFixed(1)}°, which an arc of one turn cannot draw.`;
  }
  const crossedFrom = num(holes, "adc.crossed.from_counts");
  const crossedTo = num(holes, "adc.crossed.to_counts");
  if (crossedFrom === undefined || crossedTo === undefined) {
    return lacks("results/table.json holes.adc.crossed");
  }
  const margin = num(holes, "adc.edge_margin_counts") ?? 0;
  const theta = (raw: number) => thetaAt(raw, points, cal);
  const span = (from: number, to: number): [number, number] => {
    const [a, b] = [theta(from), theta(to)];
    return [Math.min(a, b), Math.max(a, b)];
  };
  const [lo, hi] = [Math.min(cal.rawMin, cal.rawMax), Math.max(cal.rawMin, cal.rawMax)];
  const avgCountsPerDeg = (hi - lo) / travelDeg;

  const good: Good[] = [];
  for (let k = 0; k < INTERVALS; k++) {
    const from = Math.max(k * GRID, crossedFrom);
    const to = Math.min((k + 1) * GRID, crossedTo);
    if (to <= from) continue;
    const gain = gainAt(points, k);
    const q = gain > 0 ? 1 / gain : 0;
    const [a, b] = span(from, to);
    good.push({
      kind: "good",
      key: "",
      fromDeg: a,
      toDeg: b,
      fromRaw: from,
      toRaw: Math.min((k + 1) * GRID - 1, crossedTo),
      counts: to - from,
      q,
      gain,
      countsPerDeg: avgCountsPerDeg * q,
    });
  }

  const unjudged: Unjudged[] = [];
  const stretch = (from: number, to: number, why: Unjudged["why"]) => {
    if (to <= from) return;
    const [a, b] = span(from, to);
    unjudged.push({
      kind: "not judged",
      key: "",
      fromDeg: a,
      toDeg: b,
      fromRaw: from,
      toRaw: to,
      counts: to - from,
      why,
    });
  };
  const sweptFrom = Math.max(lo, crossedFrom - margin);
  const sweptTo = Math.min(hi, crossedTo + margin);
  stretch(lo, sweptFrom, "uncrossed");
  stretch(sweptFrom, crossedFrom, "turn");
  stretch(crossedTo, sweptTo, "turn");
  stretch(sweptTo, hi, "uncrossed");

  const pot: PotHole[] = list(holes, "pot.holes").flatMap((h): PotHole[] => {
    const [from, to] = [num(h, "from_counts"), num(h, "to_counts")];
    if (from === undefined || to === undefined) return [];
    const [a, b] = span(from, to);
    return [
      {
        kind: "pot",
        key: "",
        fromDeg: a,
        toDeg: b,
        fromRaw: from,
        toRaw: to,
        counts: num(h, "counts") ?? to - from,
        deg: num(h, "deg") ?? b - a,
        cycles: num(h, "cycles"),
        shaftDeg: num(h, "shaft_deg"),
        rMax: num(h, "r_max"),
        passes: nums(h, "passes"),
        dirs: nums(h, "dirs"),
      },
    ];
  });

  const slots = wideSlots(set);
  const adc: AdcCode[] = [];
  const offCarry: OffCarry[] = [];
  const perCount = travelDeg / (hi - lo);
  for (const h of list(holes, "adc.runs")) {
    const [from, to] = [num(h, "from_counts"), num(h, "to_counts")];
    if (from === undefined || to === undefined) continue;
    const n = num(h, "counts") ?? to - from + 1;
    const [a, b] = span(from, to + 1);
    const carry = num(h, "above_carry");
    if (carry === undefined) {
      offCarry.push({ fromRaw: from, toRaw: to, counts: n, fromDeg: a, toDeg: b });
      continue;
    }
    adc.push({
      kind: "adc",
      key: "",
      fromDeg: a,
      toDeg: b,
      fromRaw: from,
      toRaw: to,
      counts: n,
      carry,
      slot: slots[(carry & ADC_MASK) >> WIDE_SHIFT] ?? 0,
      deg: num(h, "deg") ?? b - a,
    });
  }
  slots.forEach((slot, i) => {
    const carry = (i << WIDE_SHIFT) | 0xff;
    if (slot === 0 || adc.some((m) => m.carry === carry)) return;
    const n = Math.round((2 * slot) / SLOT_Q);
    if (carry + 1 < lo || carry + n > hi) return;
    const [a, b] = span(carry + 1, carry + n + 1);
    adc.push({
      kind: "adc",
      key: "",
      fromDeg: a,
      toDeg: b,
      fromRaw: carry + 1,
      toRaw: carry + n,
      counts: n,
      carry,
      slot,
      deg: n * perCount,
    });
  });

  const byAngle = (a: { fromDeg: number }, b: { fromDeg: number }) => a.fromDeg - b.fromDeg;
  for (const marks of [good, unjudged, pot, adc] as Mark[][]) {
    marks.sort(byAngle);
    marks.forEach((m, i) => (m.key = `${m.kind}-${String(i)}`));
  }
  offCarry.sort(byAngle);

  const resolution: Good[] = [];
  const every = TABLE_ROW_EVERY_DEG;
  for (let d = Math.floor(cwDeg / every) * every + every; d < cwDeg + travelDeg; d += every) {
    const g = good.find((m) => d - cwDeg >= m.fromDeg && d - cwDeg < m.toDeg);
    if (g !== undefined && !resolution.includes(g)) resolution.push(g);
  }
  const stops: Mark[] = [...unjudged, ...pot, ...adc, ...resolution].sort(
    (a, b) => (a.fromDeg + a.toDeg) / 2 - (b.fromDeg + b.toDeg) / 2,
  );

  const longest = (marks: readonly (PotHole | AdcCode)[]) =>
    marks.reduce<PotHole | AdcCode | undefined>(
      (best, m) => (best === undefined || m.counts > best.counts ? m : best),
      undefined,
    );
  const m = list(holes, "pot.m")
    .map((e) => num(e, "counts_per_cycle"))
    .filter((v) => v !== undefined);

  return {
    travelDeg,
    cwDeg,
    avgCountsPerDeg,
    good,
    pot,
    adc,
    unjudged,
    offCarry,
    stops,
    resolution,
    longestPot: longest(pot) as PotHole | undefined,
    widestAdc: longest(adc) as AdcCode | undefined,
    spread: middle90(good),
    edgeMarginCounts: margin,
    potRule: {
      perCycle: m.length === 0 ? undefined : [Math.min(...m), Math.max(...m)],
      s: num(holes, "pot.s"),
      line: num(holes, "pot.line"),
      farK: num(holes, "pot.far_k"),
    },
    notRead: groupNotRead(list(holes, "pot.not_read")),
    potSource: str(holes, "source.pot"),
    adcSource: str(holes, "source.adc"),
  };
}

export function degText(v: number, digits = 1): string {
  return `${v.toFixed(digits)}°`;
}

function countsText(n: number, one: string, many: string): string {
  const v = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return `${v} ${n === 1 ? one : many}`;
}

export function andText(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1] ?? ""}`;
}

/** What a mark is called in the legend, the pane's title and the table. */
export function kindText(m: Mark): string {
  switch (m.kind) {
    case "good":
      return "resolution";
    case "pot":
      return "position hole";
    case "adc":
      return m.slot === 0 ? "ADC wide code, no stored slot" : "ADC wide code";
    case "not judged":
      return "no wide code judged";
  }
}

/** The SVG's summary for a screen reader, from the data. */
export function summary(arc: Arc): string {
  const parts: string[] = [];
  const p = arc.longestPot;
  parts.push(
    p === undefined
      ? "no position holes"
      : `${countsText(arc.pot.length, "position hole", "position holes")}, the longest ${countsText(p.counts, "count", "counts")} (${p.deg.toFixed(2)} degrees) from ${(arc.cwDeg + p.fromDeg).toFixed(1)} to ${(arc.cwDeg + p.toDeg).toFixed(1)} degrees`,
  );
  const a = arc.widestAdc;
  parts.push(
    a === undefined
      ? "no ADC wide codes"
      : `${countsText(arc.adc.length, "ADC wide code", "ADC wide codes")}, the widest ${countsText(a.counts, "code", "codes")} at ${(arc.cwDeg + a.fromDeg).toFixed(1)} degrees`,
  );
  if (arc.spread !== undefined) {
    parts.push(
      `${arc.spread[0].toFixed(2)} to ${arc.spread[1].toFixed(2)} times the average resolution across 90 % of the judged travel`,
    );
  }
  return `Position sensor over ${arc.travelDeg.toFixed(1)} degrees: ${parts.join("; ")}.`;
}

/** The center readout under the travel: the longest pot hole, then the widest wide code. */
export function readout(arc: Arc): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const p = arc.longestPot;
  out.push(
    p === undefined
      ? { label: "longest position hole", value: "none listed" }
      : {
          label: "longest position hole",
          value: `${countsText(p.counts, "count", "counts")} (${p.deg.toFixed(2)}°) at raw ${rawText(p.fromRaw)}..${rawText(p.toRaw)}`,
        },
  );
  const a = arc.widestAdc;
  out.push(
    a === undefined
      ? { label: "widest ADC wide code", value: "none listed" }
      : {
          label: "widest ADC wide code",
          value: `${countsText(a.counts, "code", "codes")} (${a.deg.toFixed(2)}°) at raw ${rawText(a.fromRaw)}..${rawText(a.toRaw)}`,
        },
  );
  return out;
}

/** The pane for a mark: a title, its lines, and the plain sentence. */
export interface Pane {
  title: string;
  lines: string[];
  says: string;
  more: string[];
}

function plainResolution(t: number): string {
  if (t > 0.07) return "Finer than average: each count here is a smaller step of the horn.";
  if (t < -0.07) return "Coarser than average: each count here is a bigger step of the horn.";
  return "About the average: each count here is an average step of the horn.";
}

function passesText(passes: readonly number[]): string {
  return passes.length === 0
    ? ""
    : `on ${passes.length === 1 ? "pass" : "passes"} ${andText(passes.map(String))}`;
}

function dirsText(dirs: readonly number[]): string {
  const words = dirs.map((d) => (d < 0 ? "counts falling" : "counts rising"));
  return words.length === 0
    ? ""
    : `, ${words.length === 1 ? "with the" : "with"} ${andText(words)}`;
}

export function paneOf(m: Mark, arc: Arc): Pane {
  const where = `${degText(arc.cwDeg + m.fromDeg)} to ${degText(arc.cwDeg + m.toDeg)}`;
  switch (m.kind) {
    case "good":
      return {
        title: where,
        lines: [
          `raw ${rawText(m.fromRaw)}..${rawText(m.toRaw)}`,
          `the pot gives ${m.countsPerDeg.toFixed(1)} counts a degree here, ${m.q.toFixed(2)}× its average of ${arc.avgCountsPerDeg.toFixed(1)}`,
          `the table spreads these counts by ${m.gain.toFixed(2)} to land on true degrees`,
        ],
        says: plainResolution(shadeOf(m.q)),
        more: [],
      };
    case "pot": {
      const r = arc.potRule;
      const moved =
        m.cycles === undefined
          ? undefined
          : `the motor turned ${countsText(m.cycles, "ripple cycle", "ripple cycles")}${m.shaftDeg === undefined ? "" : ` (${m.shaftDeg.toFixed(2)}° at the horn)`} while the pot ran ${countsText(m.counts, "count", "counts")}`;
      const seen = passesText(m.passes);
      const rule =
        r.perCycle === undefined || r.line === undefined
          ? undefined
          : `found by: pot counts a ripple cycle, ${r.perCycle[0].toFixed(2)} to ${r.perCycle[1].toFixed(2)} typical on the passes; a hole where they run over ${r.line.toFixed(2)}× typical${r.farK === undefined || r.s === undefined ? "" : ` (1 + ${String(r.farK)} × ${r.s.toFixed(2)})`}${m.rMax === undefined ? "" : `, here up to ${m.rMax.toFixed(1)}×`}`;
      return {
        title: "Position hole",
        lines: [
          `${where}, ${countsText(m.counts, "count", "counts")} (${m.deg.toFixed(2)}°)`,
          `raw ${rawText(m.fromRaw)}..${rawText(m.toRaw)}`,
          ...(moved === undefined ? [] : [moved]),
          ...(seen === "" ? [] : [`seen ${seen}${dirsText(m.dirs)}`]),
        ],
        says: "The pot ran far more counts than the motor turned: inside this stretch the position jumps.",
        more: rule === undefined ? [] : [rule],
      };
    }
    case "adc":
      return {
        title: `ADC wide code above ${String(m.carry)}`,
        lines: [
          `${degText(arc.cwDeg + m.fromDeg)}, raw ${rawText(m.fromRaw)}..${rawText(m.toRaw)}, ${countsText(m.counts, "code", "codes")} (${m.deg.toFixed(2)}°)`,
        ],
        says:
          m.slot === 0
            ? "The converter skips these codes on every channel. That is the board, not the pot. No stored slot covers it, so the servo reads the stuck code as it comes."
            : "The converter skips these codes on every channel. That is the board, not the pot. The stored slot reads the stuck code as the middle of the gap.",
        more: [
          `Drawn as a tick because the run starts just above carry ${String(m.carry)}; codes never read anywhere else belong to a position hole and are not drawn here.`,
        ],
      };
    case "not judged":
      return {
        title: "No wide code judged",
        lines: [`${where}, raw ${rawText(m.fromRaw)}..${rawText(m.toRaw)}`],
        says:
          m.why === "turn"
            ? `The passes turn here, so no wide code is judged within ${String(arc.edgeMarginCounts)} counts of a turn.`
            : "No slow pass crossed these codes.",
        more: ["Position holes are judged here: the pot rule reads each slow rung's whole drive."],
      };
  }
}

/** A row of the table view. */
export interface Row {
  key: string;
  kind: string;
  fromDeg: string;
  toDeg: string;
  fromRaw: string;
  toRaw: string;
  counts: string;
  note: string;
}

function rowOf(m: Mark | OffCarry, cwDeg: number, kind: string, note: string, key: string): Row {
  return {
    key,
    kind,
    fromDeg: (cwDeg + m.fromDeg).toFixed(2),
    toDeg: (cwDeg + m.toDeg).toFixed(2),
    fromRaw: rawText(m.fromRaw),
    toRaw: rawText(m.toRaw),
    counts: Number.isInteger(m.counts) ? String(m.counts) : m.counts.toFixed(1),
    note,
  };
}

/** Every hole, wide code and not-judged stretch, and a resolution row every 10 deg, in angle order. */
export function tableRows(arc: Arc): Row[] {
  const row = (m: Mark | OffCarry, kind: string, note: string, key: string) =>
    rowOf(m, arc.cwDeg, kind, note, key);
  const marks = arc.stops.map((m) => {
    switch (m.kind) {
      case "good":
        return row(m, kindText(m), `${m.q.toFixed(2)}× the average counts a degree`, m.key);
      case "pot":
        return row(m, kindText(m), `${m.deg.toFixed(2)}°`, m.key);
      case "adc":
        return row(m, kindText(m), `above carry ${String(m.carry)}`, m.key);
      case "not judged":
        return row(
          m,
          kindText(m),
          m.why === "turn" ? "the passes turn here" : "no slow pass crossed",
          m.key,
        );
    }
  });
  const off = arc.offCarry.map((o, i) =>
    row(o, "never read, not above a carry", "part of a position stretch", `off-${String(i)}`),
  );
  return [...marks, ...off].sort((a, b) => Number(a.fromDeg) - Number(b.fromDeg));
}
