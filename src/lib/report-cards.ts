// What each card of the run report shows, from the run's files. A card whose
// entries the run did not accept says why instead, in the run's own terms.

import { errorSeries, type ErrorSeries } from "./pos-lut";
import { NO_HEAT_MODEL } from "./profile-form";
import {
  angleMap,
  freeSpeed,
  list,
  notReached,
  num,
  rawText,
  short,
  spreadSaid,
  str,
  tablePoints,
  termAt,
  valueSaid,
  wideSlots,
  at,
  type RunDocs,
  type Term,
} from "./report";
import type { RunStep } from "./run-folder";
import { degPerCount, type Calibration } from "./units";

export type Card<T> = { data: T } | { why: string };

function card<T>(
  steps: readonly RunStep[],
  needs: readonly string[],
  make: () => T | string,
): Card<T> {
  const why = notReached(steps, needs);
  if (why !== undefined) return { why };
  const made = make();
  return typeof made === "string" ? { why: made } : { data: made };
}

function lacks(file: string): string {
  return `The run folder holds no ${file}.`;
}

export interface Tile {
  label: string;
  value: string;
  spread?: string;
  about: string;
}

function termTile(label: string, t: Term | undefined, file: string, about: string): Tile | string {
  if (t === undefined) return lacks(file);
  return { label, value: valueSaid(t), spread: spreadSaid(t), about };
}

/** The run voltage the policy states, V. */
function runVolts(docs: RunDocs): number | undefined {
  const line = list(docs.get("inputs/resolved.json"), "fields").find(
    (f) => str(f, "field") === "protection.run_v",
  );
  return num(line, "value") ?? num(docs.get("inputs/nameplate.json"), "run_v");
}

function worst(
  moves: readonly unknown[],
  key: string,
): { name: string; value: number } | undefined {
  let best: { name: string; value: number } | undefined;
  for (const m of moves) {
    const v = num(m, key);
    if (v !== undefined && (best === undefined || v > best.value)) {
      best = { name: str(m, "name") ?? "", value: v };
    }
  }
  return best;
}

/** The speed gain the final check ran at, as the set stores it, and the tune's try. */
function gainText(docs: RunDocs): string {
  const kp = num(docs.get("final/set.json"), "fields.v_kp_q88.value");
  const tried = num(docs.get("run.json"), "final.try");
  const at0 = kp === undefined ? "" : ` at v_kp_q88 ${String(kp)}`;
  const from = tried === undefined ? "" : `, the tune's try ${String(tried)}`;
  return `the final check's closed-loop moves${at0}${from}`;
}

export function headlineTiles(docs: RunDocs, steps: readonly RunStep[]): Card<Tile>[] {
  const measured = docs.get("inputs/measured.json");
  const holes = at(docs.get("results/table.json"), "holes");
  return [
    card(steps, ["final"], () => {
      const cal = angleMap(docs.get("final/set.json"));
      if (cal === undefined) return lacks("final/set.json angle map");
      return {
        label: "Travel",
        value: `${(Math.abs(cal.angleMaxCdeg - cal.angleMinCdeg) / 100).toFixed(2)} deg`,
        about: `the set's angle map, raw ${String(cal.rawMin)} to ${String(cal.rawMax)}`,
      };
    }),
    card(steps, ["gather"], () => {
      const board = num(measured, "r_board_c.value");
      return termTile(
        "Winding resistance",
        termAt(measured, "r_ohm"),
        "inputs/measured.json",
        board === undefined
          ? "seated at both stops"
          : `seated at both stops, the board at ${board.toFixed(1)} C`,
      );
    }),
    card(steps, ["stops"], () =>
      termTile(
        "Winding resistance at 25 C",
        termAt(docs.get("results/stops.json"), "estimates.r_seated_25c_ohm"),
        "results/stops.json",
        "the seated resistance through copper's slope to 25 C",
      ),
    ),
    card(steps, ["gather"], () =>
      termTile(
        "Motor constant Ke",
        termAt(measured, "ke_v_s_per_rad"),
        "inputs/measured.json",
        "volts per motor rad/s, from the coasts",
      ),
    ),
    card(steps, ["gather"], () =>
      termTile(
        "Inertia J",
        termAt(measured, "j_kg_m2"),
        "inputs/measured.json",
        "at the motor, from the run-ups",
      ),
    ),
    card(steps, ["gather"], () => {
      const ke = termAt(measured, "ke_v_s_per_rad");
      const gear = num(docs.get("inputs/nameplate.json"), "gear_ratio");
      const volts = runVolts(docs);
      if (ke === undefined) return lacks("inputs/measured.json Ke");
      if (gear === undefined) return "The profile states no gear ratio.";
      if (volts === undefined) return "The run states no run voltage.";
      const speed = freeSpeed(volts, ke, gear);
      if (speed === undefined) return "Ke is not over 0.";
      return {
        label: `Free speed at ${String(volts)} V`,
        value: valueSaid(speed),
        spread: spreadSaid(speed),
        about: `${String(volts)} V over Ke is ${short(volts / ke.value)} motor rad/s; over the gear ratio ${String(gear)}, ${short(speed.value)} deg/s at the horn`,
      };
    }),
    card(steps, ["cruise"], () =>
      termTile(
        "Friction at a slow move",
        termAt(docs.get("results/cruise.json"), "estimates.friction_coulomb_ma"),
        "results/cruise.json",
        "the current that keeps the horn moving, the cruise line at zero speed",
      ),
    ),
    card(steps, ["final"], () => {
      const moves = list(docs.get("final/results/verify.json"), "moves");
      if (moves.length === 0) return lacks("final/results/verify.json moves");
      const over = worst(moves, "overshoot_deg");
      const rest = worst(moves, "rest_error_deg");
      return {
        label: "Move check",
        value: `${String(moves.length)} moves`,
        spread: [
          over && `worst overshoot ${over.value.toFixed(2)} deg (${over.name})`,
          rest && `worst rest error ${rest.value.toFixed(2)} deg (${rest.name})`,
        ]
          .filter(Boolean)
          .join(", "),
        about: gainText(docs),
      };
    }),
    card(steps, ["table"], () => {
      if (holes === undefined) return lacks("results/table.json holes");
      const all = list(holes, "pot.holes");
      const longest = at(holes, "pot.longest");
      const n = `${String(all.length)} ${all.length === 1 ? "hole" : "holes"} listed`;
      if (longest === undefined || longest === null) {
        return { label: "Longest position hole", value: "none", spread: n, about: "the pot" };
      }
      return {
        label: "Longest position hole",
        value: `${(num(longest, "deg") ?? 0).toFixed(2)} deg`,
        spread: `${(num(longest, "counts") ?? 0).toFixed(1)} counts at raw ${rawText(num(longest, "from_counts") ?? 0)}..${rawText(num(longest, "to_counts") ?? 0)}; ${n}`,
        about: "the pot",
      };
    }),
    card(steps, ["table"], () => {
      if (holes === undefined) return lacks("results/table.json holes");
      const runs = list(holes, "adc.runs");
      const longest = at(holes, "adc.longest");
      const n = `${String(runs.length)} listed`;
      if (longest === undefined || longest === null) {
        return { label: "Widest ADC wide code", value: "none", spread: n, about: "the converter" };
      }
      return {
        label: "Widest ADC wide code",
        value: `${String(num(longest, "counts") ?? 0)} codes`,
        spread: `${(num(longest, "deg") ?? 0).toFixed(2)} deg at raw ${rawText(num(longest, "from_counts") ?? 0)}..${rawText(num(longest, "to_counts") ?? 0)}; ${n}`,
        about: "the converter, the same on every channel",
      };
    }),
  ];
}

export interface Accuracy {
  series: ErrorSeries;
  /** Up less down, deg rms, per 256 raw counts, aligned to `series.x`; null where no band. */
  directions: (number | null)[];
  /** The passes the table never saw: rung and its line-out rms, counts and deg. */
  held: { rung: number; counts: number; deg: number }[];
}

export function accuracy(docs: RunDocs, steps: readonly RunStep[]): Card<Accuracy> {
  return card(steps, ["table", "final"], () => {
    const cal = angleMap(docs.get("final/set.json"));
    const points = tablePoints(docs.get("final/inputs/pos_lut.json"));
    if (cal === undefined) return lacks("final/set.json angle map");
    if (points.length !== 256) return lacks("final/inputs/pos_lut.json points");
    const table = docs.get("results/table.json");
    const series = errorSeries(points, cal);
    const per = Math.abs(degPerCount(cal));
    const bands = list(table, "table.report.directions.bands").flatMap((b) => {
      const from = num(b, "from_counts");
      const rms = num(b, "counts_rms");
      return from === undefined || rms === undefined ? [] : [{ from, rms }];
    });
    const directions: (number | null)[] = [];
    for (let raw = cal.rawMin; raw <= cal.rawMax; raw++) {
      const band = bands.find((b) => raw >= b.from && raw < b.from + 256);
      directions.push(band === undefined ? null : band.rms * per);
    }
    if (degPerCount(cal) < 0) directions.reverse();
    const held = list(table, "table.one_fast_pass_out").flatMap((o) => {
      const rung = num(o, "rung");
      const rms = num(o, "line_out_counts_rms");
      return rung === undefined || rms === undefined ? [] : [{ rung, counts: rms, deg: rms * per }];
    });
    return { series, directions, held };
  });
}

export interface MoveScore {
  name: string;
  fromCounts: number;
  goalCounts: number;
  stepDeg: number | undefined;
  overshootDeg: number | undefined;
  overshootBoundDeg: number | undefined;
  settleS: number | undefined;
  restErrorDeg: number | undefined;
  currentPeakA: number | undefined;
  followPeakDeg: number | undefined;
}

export interface Moves {
  moves: MoveScore[];
  cal: Calibration;
  points: number[];
  slots: number[];
  currentZeroCounts: number;
  countsPerA: number;
}

export function moves(docs: RunDocs, steps: readonly RunStep[]): Card<Moves> {
  return card(steps, ["final"], () => {
    const set = docs.get("final/set.json");
    const verify = docs.get("final/results/verify.json");
    const cal = angleMap(set);
    if (cal === undefined) return lacks("final/set.json angle map");
    if (verify === undefined) return lacks("final/results/verify.json");
    const zero = num(verify, "units.current_zero_counts");
    const perA = num(verify, "units.counts_per_a.value");
    if (zero === undefined || perA === undefined) return lacks("final/results/verify.json units");
    const scores = list(verify, "moves").map((m): MoveScore => ({
      name: str(m, "name") ?? "",
      fromCounts: num(m, "from_counts") ?? 0,
      goalCounts: num(m, "goal_counts") ?? 0,
      stepDeg: num(m, "step_deg"),
      overshootDeg: num(m, "overshoot_deg"),
      overshootBoundDeg: num(m, "overshoot_bound_deg"),
      settleS: num(m, "settle_s"),
      restErrorDeg: num(m, "rest_error_deg"),
      currentPeakA: num(m, "current_peak_a"),
      followPeakDeg: num(m, "follow_peak_deg"),
    }));
    return {
      moves: scores,
      cal,
      points: tablePoints(docs.get("final/inputs/pos_lut.json")),
      slots: wideSlots(set),
      currentZeroCounts: zero,
      countsPerA: perA,
    };
  });
}

export interface Point {
  x: number;
  y: number;
}

export interface Speed {
  up: Point[];
  down: Point[];
  stated: Point[];
  /** V / Ke at the horn, from 0 V to the highest volts shown. */
  line: Point[];
  ke: Term;
}

/** Degrees per pot count the run's table scale gives. */
function degPerScaleCount(docs: RunDocs): number | undefined {
  const cpd = num(docs.get("inputs/measured.json"), "table.counts_per_deg");
  return cpd === undefined || cpd === 0 ? undefined : 1 / cpd;
}

export function speed(docs: RunDocs, steps: readonly RunStep[]): Card<Speed> {
  return card(steps, ["spins", "gather"], () => {
    const ke = termAt(docs.get("inputs/measured.json"), "ke_v_s_per_rad");
    const nameplate = docs.get("inputs/nameplate.json");
    const gear = num(nameplate, "gear_ratio");
    const per = degPerScaleCount(docs);
    if (ke === undefined) return lacks("inputs/measured.json Ke");
    if (gear === undefined) return "The profile states no gear ratio.";
    if (per === undefined) return lacks("inputs/measured.json table scale");
    const up: Point[] = [];
    const down: Point[] = [];
    for (const s of list(docs.get("results/spins.json"), "spins")) {
      const volts = num(s, "volts");
      const cps = num(s, "pot_speed_cps");
      if (volts === undefined || cps === undefined) continue;
      (num(s, "dir") === -1 ? down : up).push({ x: volts, y: Math.abs(cps) * per });
    }
    const stated = list(nameplate, "no_load").flatMap((r) => {
      const [v, deg, s] = [num(r, "at_v"), num(r, "per_deg"), num(r, "seconds")];
      return v === undefined || deg === undefined || s === undefined || s === 0
        ? []
        : [{ x: v, y: deg / s }];
    });
    const top = Math.max(0, ...[...up, ...down, ...stated].map((p) => p.x));
    const line = [0, top].map((v) => ({ x: v, y: freeSpeed(v, ke, gear)?.value ?? 0 }));
    return { up, down, stated, line, ke };
  });
}

export interface Effort {
  up: Point[];
  down: Point[];
  mean: Point[];
  line: Point[];
  coulombMa: number;
  viscousMaPerDegS: number;
  rmsMa: number | undefined;
  legs: number | undefined;
}

export function effort(docs: RunDocs, steps: readonly RunStep[]): Card<Effort> {
  return card(steps, ["cruise", "gather"], () => {
    const line = at(docs.get("results/cruise.json"), "line");
    const per = degPerScaleCount(docs);
    const coulomb = num(line, "coulomb_ma");
    const viscous = num(line, "viscous_ma_per_kcps");
    if (coulomb === undefined || viscous === undefined) return lacks("results/cruise.json line");
    if (per === undefined) return lacks("inputs/measured.json table scale");
    const up: Point[] = [];
    const down: Point[] = [];
    const mean: Point[] = [];
    for (const s of list(line, "speeds")) {
      const cps = num(s, "goal_cps");
      if (cps === undefined) continue;
      const x = cps * per;
      const [u, d, m] = [num(s, "up_ma"), num(s, "down_ma"), num(s, "current_ma")];
      if (u !== undefined) up.push({ x, y: u });
      if (d !== undefined) down.push({ x, y: d });
      if (m !== undefined) mean.push({ x, y: m });
    }
    const top = Math.max(0, ...mean.map((p) => p.x));
    const viscousMaPerDegS = viscous / 1000 / per;
    return {
      up,
      down,
      mean,
      line: [0, top].map((x) => ({ x, y: coulomb + viscousMaPerDegS * x })),
      coulombMa: coulomb,
      viscousMaPerDegS,
      rmsMa: num(line, "rms_ma"),
      legs: num(line, "legs"),
    };
  });
}

/** A resolved value in words: "200 deg/s", "2/3 of the stated no-load speed". */
export function resolvedText(line: unknown): string {
  const v = at(line, "value");
  const unit = str(line, "unit") ?? "";
  const value =
    typeof v === "number"
      ? String(v)
      : Array.isArray(v) && v.length === 2
        ? `${String(v[0])}/${String(v[1])}`
        : typeof v === "string"
          ? v
          : "";
  return unit === "" ? value : `${value} ${unit}`;
}

export interface ResolvedLine {
  field: string;
  label?: string;
  form: string;
  value: string;
  binds: string;
  note: string | undefined;
}

export interface CrossCheck {
  what: string;
  run: string;
  stated: string;
  statedFrom: string | undefined;
  difference: string | undefined;
}

export interface Inputs {
  profile: string;
  policy: string;
  headline: ResolvedLine[];
  lines: ResolvedLine[];
  clamps: string[];
  heat: string | undefined;
  checks: CrossCheck[];
}

const HEADLINE: readonly [string, string][] = [
  ["protection.speed_ceiling", "Speed ceiling"],
  ["motion.move_speed", "Move speed"],
  ["protection.current_limit", "Current limit"],
  ["protection.yield", "Yield current"],
  ["protection.stall_speed", "Stall speed"],
];

function named(n: unknown): string {
  const key = str(n, "key") ?? "unnamed";
  const rev = num(n, "revision");
  return rev === undefined ? key : `${key} rev ${String(rev)}`;
}

function crossCheck(what: string, c: unknown): CrossCheck {
  const run = termAt(c, "run");
  const stated = at(c, "stated");
  const sv = num(stated, "value");
  const diff = num(c, "difference_pct");
  return {
    what,
    run: run === undefined ? "none" : `${valueSaid(run)} ${spreadSaid(run)}`,
    stated: sv === undefined ? "states none" : `${short(sv)} ${str(stated, "unit") ?? ""}`.trim(),
    statedFrom: str(stated, "from"),
    difference: diff === undefined ? undefined : `${diff >= 0 ? "+" : ""}${diff.toFixed(2)} %`,
  };
}

/** A row's check as gather names it: "free speed at 4.8 V, V / Ke (the row the run voltage binds)". */
function rowWhat(what: string, formula: string, c: unknown): string {
  const v = num(c, "at_v");
  const binds = at(c, "binds") === true ? " (the row the run voltage binds)" : "";
  return `${what} at ${v === undefined ? "?" : String(v)} V, ${formula}${binds}`;
}

export function inputs(docs: RunDocs, steps: readonly RunStep[]): Card<Inputs> {
  return card(steps, ["gather"], () => {
    const resolved = docs.get("inputs/resolved.json");
    if (resolved === undefined) return lacks("inputs/resolved.json");
    const lines = list(resolved, "fields").map((f): ResolvedLine => ({
      field: str(f, "field") ?? "",
      form: str(f, "form") ?? "",
      value: resolvedText(f),
      binds: str(f, "binds") ?? "",
      note: str(f, "note"),
    }));
    const headline = HEADLINE.flatMap(([field, label]) => {
      const l = lines.find((x) => x.field === field);
      return l === undefined ? [] : [{ ...l, label }];
    });
    const clamps = list(resolved, "fields").flatMap((f) => {
      const clamp = str(f, "clamp");
      return clamp === undefined ? [] : [`${str(f, "field") ?? ""}: ${clamp}`];
    });
    const cc = docs.get("inputs/cross-checks.json");
    const checks: CrossCheck[] = [];
    if (at(cc, "travel") !== undefined) checks.push(crossCheck("travel", at(cc, "travel")));
    for (const c of list(cc, "free_speed")) {
      checks.push(crossCheck(rowWhat("free speed", "V / Ke", c), c));
    }
    for (const c of list(cc, "stall_current")) {
      checks.push(crossCheck(rowWhat("stall current", "V / R", c), c));
    }
    return {
      profile: named(at(resolved, "profile")),
      policy: named(at(resolved, "policy")),
      headline,
      lines,
      clamps,
      heat: docs.has("inputs/thermal.json") ? undefined : NO_HEAT_MODEL,
      checks,
    };
  });
}

/** The command that stores the run's final set, run from the folder that holds `<uid>/`. */
export function saveLine(
  docs: RunDocs,
  steps: readonly RunStep[],
  setFile: string | undefined,
  uid: string,
  utc: string,
  id: number | undefined,
): Card<string> {
  return card(steps, ["final"], () => {
    if (setFile === undefined) return "run.json names no final set.";
    const at0 = `${uid}/${utc}`;
    const live = str(docs.get("final/set.json"), "pos_table.state") === "LIVE";
    const table = live ? ` --table ${at0}/final/inputs/pos_lut.json` : "";
    return `osc-ident --id ${id === undefined ? "<bus id>" : String(id)} save --set ${at0}/${setFile}${table}`;
  });
}
