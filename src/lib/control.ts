// The Live page's control cluster, minus React: the servo's mode and goal
// registers, and each goal's range and unit conversion.

import type { Value } from "@openservocore/client";
import type { Sample } from "./telemetry";
import {
  ADC_MAX_COUNT,
  ampsPerCount,
  calibrationStatus,
  currentMa,
  degPerCount,
  degToCounts,
  positionDeg,
  velocityDegPerS,
  type Calibration,
  type ReadRegister,
  type Sense,
} from "./units";

/** Seconds of samples the panels show. */
export const WINDOWS_S = [4, 10, 30] as const;
export type WindowS = (typeof WINDOWS_S)[number];

export function isWindow(value: number): value is WindowS {
  return WINDOWS_S.some((w) => w === value);
}

/** Duties are q15 fractions of full drive (firmware regions/control.rs). */
const Q15 = 2 ** 15;
/** goal_duty is an i16, so full drive itself is one count out of reach. */
const DUTY_MAX_Q15 = Q15 - 1;

/** The `mode` enum's variants by name, each with the goal register it runs on. */
export const MODES = [
  { name: "OpenLoop", label: "Open loop", goal: "goal_duty" },
  { name: "Current", label: "Current", goal: "goal_current" },
  { name: "Velocity", label: "Velocity", goal: "goal_velocity" },
  { name: "Position", label: "Position", goal: "goal_position" },
] as const;
export type ModeName = (typeof MODES)[number]["name"];
export type GoalRegister = (typeof MODES)[number]["goal"];

export function isMode(name: string): name is ModeName {
  return MODES.some((m) => m.name === name);
}

export function modeLabel(name: ModeName): string {
  return MODES.find((m) => m.name === name)?.label ?? name;
}

/** One READ (protocol sec 3.1) covers the switch, the mode and every goal. */
export const CONTROL_REGISTERS: readonly string[] = [
  "torque_enable",
  "mode",
  ...MODES.map((m) => m.goal),
];

/** The soft limits, low then high: an application's travel inside the physical stops. */
export const SOFT_LIMITS = ["pos_min_soft_counts", "pos_max_soft_counts"] as const;
/** The physical stops, low then high, which stand in for the soft limits while those are off. */
export const PHYS_STOPS = ["pos_min_phys_counts", "pos_max_phys_counts"] as const;

export const LIMIT_REGISTERS: readonly string[] = [
  ...PHYS_STOPS,
  ...SOFT_LIMITS,
  "duty_max_q15",
  "speed_ceiling_cps",
  "current_limit_counts",
];

export interface ControlState {
  torque: boolean;
  /** The `mode` enum's discriminant as written. */
  mode: number;
  goals: Record<GoalRegister, number>;
}

/** The config ceilings the goal validators and the trajectory clamp to. */
export interface Limits {
  /** The travel the trajectory clamps to: the soft limits, or the physical stops while those are off. */
  travel: Range;
  dutyMaxQ15: number;
  speedCeilingCps: number;
  currentLimitCounts: number;
}

export function decodeControl(read: ReadRegister): ControlState {
  return {
    torque: read("torque_enable") !== 0,
    mode: read("mode"),
    goals: {
      goal_duty: read("goal_duty"),
      goal_position: read("goal_position"),
      goal_velocity: read("goal_velocity"),
      goal_current: read("goal_current"),
    },
  };
}

/** Soft limits of 0 / 0 are off (protocol sec 5.8). */
export function softLimitsOff(soft: Range): boolean {
  return soft.min === 0 && soft.max === 0;
}

/** The soft limits as stored, 0 / 0 while off. */
export function softLimitsFromTable(read: ReadRegister): Range {
  return { min: read(SOFT_LIMITS[0]), max: read(SOFT_LIMITS[1]) };
}

/** The travel the servo holds to: its soft limits, or its physical stops while those are off. */
export function travelFromTable(read: ReadRegister): Range {
  const soft = softLimitsFromTable(read);
  return softLimitsOff(soft) ? { min: read(PHYS_STOPS[0]), max: read(PHYS_STOPS[1]) } : soft;
}

/**
 * The soft limits after `value` is written to one side, `name`: the other
 * side as stored, or its physical stop while the pair is off. Undefined
 * for any other register.
 */
export function softLimitsAfter(
  name: string,
  value: number,
  read: ReadRegister,
): Range | undefined {
  const side = SOFT_LIMITS.findIndex((n) => n === name);
  if (side < 0) return undefined;
  const travel = travelFromTable(read);
  return side === 0 ? { min: value, max: travel.max } : { min: travel.min, max: value };
}

/**
 * Both soft limits as one write: the servo checks each side against the
 * other as stored, so 0 / 0, off, is reached in no other way.
 */
export function softLimitsWrite(soft: Range): [string, Value][] {
  return [
    [SOFT_LIMITS[0], { kind: "int", value: soft.min }],
    [SOFT_LIMITS[1], { kind: "int", value: soft.max }],
  ];
}

export function limitsFromTable(read: ReadRegister): Limits {
  return {
    travel: travelFromTable(read),
    dutyMaxQ15: read("duty_max_q15"),
    speedCeilingCps: read("speed_ceiling_cps"),
    currentLimitCounts: read("current_limit_counts"),
  };
}

/** Inclusive, in counts. */
export interface Range {
  min: number;
  max: number;
}

/** The calibrated sensor span, or the whole ADC while the calibration is not usable. */
export function positionRange(cal: Calibration): Range {
  return calibrationStatus(cal).valid
    ? { min: cal.rawMin, max: cal.rawMax }
    : { min: 0, max: ADC_MAX_COUNT };
}

function symmetric(max: number): Range {
  return { min: -max, max };
}

/** What the mode's goal validator or clamp lets through (firmware regions/control.rs). */
export function goalRange(mode: ModeName, cal: Calibration, limits: Limits): Range {
  switch (mode) {
    case "OpenLoop":
      return symmetric(Math.min(limits.dutyMaxQ15, DUTY_MAX_Q15));
    case "Current":
      return symmetric(limits.currentLimitCounts);
    case "Velocity":
      return symmetric(limits.speedCeilingCps);
    case "Position":
      return positionRange(cal);
  }
}

/**
 * The position goal sits at or past an end of travel: the calibrated span or
 * the travel the trajectory clamps to, whichever end is nearer.
 */
export function goalAtStop(goal: number, cal: Calibration, limits: Limits): boolean {
  const span = positionRange(cal);
  return (
    goal <= Math.max(span.min, limits.travel.min) || goal >= Math.min(span.max, limits.travel.max)
  );
}

export function clampGoal(counts: number, range: Range): number {
  return Math.min(range.max, Math.max(range.min, Math.round(counts)));
}

export function dutyPercent(q15: number): number {
  return (q15 * 100) / Q15;
}

export function modeName(
  variants: readonly { name: string; value: number }[],
  value: number,
): ModeName | undefined {
  const name = variants.find((v) => v.value === value)?.name;
  return name !== undefined && isMode(name) ? name : undefined;
}

export function goalOf(sample: Sample, register: GoalRegister): number {
  switch (register) {
    case "goal_duty":
      return sample.goalDuty;
    case "goal_position":
      return sample.goal;
    case "goal_velocity":
      return sample.goalVelocity;
    case "goal_current":
      return sample.goalCurrent;
  }
}

export interface UnitsContext {
  cal: Calibration;
  sense: Sense;
  /** Counts for the position family; electrical goals stay in real units. */
  raw: boolean;
}

/** How one mode's goal reads: `toDisplay` and `fromDisplay` map counts to the shown unit. */
export interface GoalUnits {
  register: GoalRegister;
  unit: string;
  digits: number;
  toDisplay: (counts: number) => number;
  /** Whole counts, not yet clamped. */
  fromDisplay: (value: number) => number;
}

export function goalUnits(mode: ModeName, { cal, sense, raw }: UnitsContext): GoalUnits {
  switch (mode) {
    case "OpenLoop":
      return {
        register: "goal_duty",
        unit: "%",
        digits: 1,
        toDisplay: dutyPercent,
        fromDisplay: (pct) => Math.round((pct * Q15) / 100),
      };
    case "Current": {
      // A command, not a shunt reading: no bias to take out.
      const perCount = ampsPerCount(sense) * 1000;
      return {
        register: "goal_current",
        unit: "mA",
        digits: 0,
        toDisplay: (counts) => currentMa(counts, 0, sense),
        fromDisplay: (ma) => (perCount > 0 ? Math.round(ma / perCount) : 0),
      };
    }
    case "Velocity": {
      const perCount = degPerCount(cal);
      return {
        register: "goal_velocity",
        unit: raw ? "counts/s" : "deg/s",
        digits: 0,
        toDisplay: (cps) => (raw ? cps : velocityDegPerS(cps, cal)),
        fromDisplay: (v) => Math.round(raw || perCount === 0 ? v : v / perCount),
      };
    }
    case "Position":
      return {
        register: "goal_position",
        unit: raw ? "counts" : "deg",
        digits: raw ? 0 : 1,
        toDisplay: (counts) => (raw ? counts : positionDeg(counts, cal)),
        fromDisplay: (v) => (raw ? Math.round(v) : degToCounts(v, cal)),
      };
  }
}

export interface GoalContext extends UnitsContext {
  limits: Limits;
}

export interface GoalSpec extends GoalUnits {
  range: Range;
}

export function goalSpec(mode: ModeName, ctx: GoalContext): GoalSpec {
  return { ...goalUnits(mode, ctx), range: goalRange(mode, ctx.cal, ctx.limits) };
}

/**
 * The goal range's ends as the display reads them, lowest first. Degrees rise
 * counterclockwise, so on a pot whose counts rise clockwise the angle map
 * descends and the ends swap: `inverted` turns the slider to match.
 */
export function displayEnds(spec: GoalSpec): { low: number; high: number; inverted: boolean } {
  const { min, max } = spec.range;
  const inverted = spec.toDisplay(max) < spec.toDisplay(min);
  return inverted ? { low: max, high: min, inverted } : { low: min, high: max, inverted };
}
