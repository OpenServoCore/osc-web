import type { Field } from "@openservocore/client";
import { expect, test } from "vitest";
import descriptor from "../../../open-servo-core/descriptors/osc-servo/0.1.json";
import fixture from "../../tests/fixtures/stall-24mhz.json";
import {
  clampGoal,
  CONTROL_REGISTERS,
  decodeControl,
  dutyPercent,
  goalOf,
  goalRange,
  goalSpec,
  isMode,
  isWindow,
  LIMIT_REGISTERS,
  limitsFromTable,
  MODES,
  modeLabel,
  modeName,
  positionRange,
  type GoalContext,
  type Limits,
} from "./control";
import { decodeSpan, planSpans } from "./bus/spans";
import type { Sample } from "./telemetry";
import { ADC_MAX_COUNT, ampsPerCount, senseFromTable, type Calibration } from "./units";

const fields = descriptor.fields as Field[];

const sense = senseFromTable((name) => {
  const v = (fixture.meta.sense as Record<string, number>)[name];
  if (v === undefined) throw new Error(`fixture carries no ${name}`);
  return v;
});
const cal: Calibration = {
  rawMin: 200,
  rawMax: 3800,
  angleMinCdeg: 0,
  angleMaxCdeg: 18000,
  gearRatioCenti: 100,
};
const swapped: Calibration = { ...cal, rawMin: 3800, rawMax: 200 };
const limits: Limits = { dutyMaxQ15: 30000, velocityLimitCps: 4000, currentLimitCounts: 280 };
const ctx: GoalContext = { cal, sense, limits, raw: false };

test("the control and limit registers plan one read each", () => {
  expect(planSpans(fields, CONTROL_REGISTERS)).toEqual([{ addr: 384, count: 18 }]);
  expect(planSpans(fields, LIMIT_REGISTERS)).toEqual([{ addr: 54, count: 20 }]);
});

test("decodeControl reads the switch, the mode and every goal", () => {
  const span = { addr: 384, count: 18 };
  const bytes = new Uint8Array(span.count);
  const view = new DataView(bytes.buffer);
  const at = (name: string) => {
    const f = fields.find((x) => x.name === name);
    if (f === undefined) throw new Error(name);
    return f.addr - span.addr;
  };
  view.setUint8(at("torque_enable"), 1);
  view.setUint8(at("mode"), 2);
  view.setInt16(at("goal_duty"), -1234, true);
  view.setInt32(at("goal_position"), 2048, true);
  view.setInt32(at("goal_velocity"), -600, true);
  view.setInt16(at("goal_current"), 150, true);
  expect(decodeControl(decodeSpan(fields, span, bytes))).toEqual({
    torque: true,
    mode: 2,
    goals: { goal_duty: -1234, goal_position: 2048, goal_velocity: -600, goal_current: 150 },
  });
});

test("limitsFromTable names the three ceilings", () => {
  const regs: Record<string, number> = {
    duty_max_q15: 30000,
    velocity_limit_cps: 4000,
    current_limit_counts: 280,
  };
  expect(limitsFromTable((name) => regs[name] ?? NaN)).toEqual(limits);
});

test("the modes carry the descriptor's variant names and plain labels", () => {
  expect(MODES.map((m) => m.name)).toEqual(["OpenLoop", "Current", "Velocity", "Position"]);
  expect(modeLabel("OpenLoop")).toBe("Open loop");
  expect(isMode("Velocity")).toBe(true);
  expect(isMode("Torque")).toBe(false);
  const variants = fields.find((f) => f.name === "mode")?.variants ?? [];
  expect(modeName(variants, 3)).toBe("Position");
  expect(modeName(variants, 9)).toBeUndefined();
});

test("goalOf picks the sample field behind each goal register", () => {
  const sample = { goal: 1, goalVelocity: 2, goalCurrent: 3, goalDuty: 4 } as Sample;
  expect(goalOf(sample, "goal_position")).toBe(1);
  expect(goalOf(sample, "goal_velocity")).toBe(2);
  expect(goalOf(sample, "goal_current")).toBe(3);
  expect(goalOf(sample, "goal_duty")).toBe(4);
});

test("the position goal spans the calibrated sensor, or the ADC while the calibration is unusable", () => {
  expect(positionRange(cal)).toEqual({ min: 200, max: 3800 });
  expect(positionRange(swapped)).toEqual({ min: 0, max: ADC_MAX_COUNT });
  expect(goalRange("Position", swapped, limits)).toEqual({ min: 0, max: ADC_MAX_COUNT });
});

test("clampGoal rounds to whole counts and pins to the range", () => {
  const range = positionRange(cal);
  expect(clampGoal(1000.4, range)).toBe(1000);
  expect(clampGoal(1000.6, range)).toBe(1001);
  expect(clampGoal(-5, range)).toBe(200);
  expect(clampGoal(5000, range)).toBe(3800);
});

test("the position goal is degrees through the calibration, or counts in raw mode", () => {
  const deg = goalSpec("Position", ctx);
  expect(deg).toMatchObject({ register: "goal_position", unit: "deg", digits: 1 });
  expect(deg.range).toEqual({ min: 200, max: 3800 });
  expect(deg.toDisplay(2000)).toBeCloseTo(90, 6);
  expect(deg.fromDisplay(90)).toBe(2000);
  expect(deg.fromDisplay(45)).toBe(1100);
  const raw = goalSpec("Position", { ...ctx, raw: true });
  expect(raw).toMatchObject({ unit: "counts", digits: 0 });
  expect(raw.toDisplay(2000)).toBe(2000);
  expect(raw.fromDisplay(1234.6)).toBe(1235);
});

test("the velocity goal is deg/s over the velocity limit, counts/s in raw mode", () => {
  const spec = goalSpec("Velocity", ctx);
  expect(spec).toMatchObject({ register: "goal_velocity", unit: "deg/s", digits: 0 });
  expect(spec.range).toEqual({ min: -4000, max: 4000 });
  // 180 deg over 3600 counts is 0.05 deg per count.
  expect(spec.toDisplay(1000)).toBeCloseTo(50, 6);
  expect(spec.fromDisplay(50)).toBe(1000);
  const raw = goalSpec("Velocity", { ...ctx, raw: true });
  expect(raw.unit).toBe("counts/s");
  expect(raw.toDisplay(1000)).toBe(1000);
  expect(raw.fromDisplay(999.6)).toBe(1000);
});

test("the current goal is milliamps over the current limit with no bias, raw or not", () => {
  const spec = goalSpec("Current", ctx);
  expect(spec).toMatchObject({ register: "goal_current", unit: "mA", digits: 0 });
  expect(spec.range).toEqual({ min: -280, max: 280 });
  const maPerCount = ampsPerCount(sense) * 1000;
  expect(spec.toDisplay(100)).toBeCloseTo(100 * maPerCount, 9);
  expect(spec.fromDisplay(100 * maPerCount)).toBe(100);
  expect(goalSpec("Current", { ...ctx, raw: true }).unit).toBe("mA");
});

test("the open-loop goal is a percent of full duty, capped by duty_max_q15 and the i16", () => {
  const spec = goalSpec("OpenLoop", ctx);
  expect(spec).toMatchObject({ register: "goal_duty", unit: "%", digits: 1 });
  expect(spec.range).toEqual({ min: -30000, max: 30000 });
  expect(spec.toDisplay(16384)).toBe(50);
  expect(spec.fromDisplay(-50)).toBe(-16384);
  expect(dutyPercent(-8192)).toBe(-25);
  const wide = goalSpec("OpenLoop", { ...ctx, limits: { ...limits, dutyMaxQ15: 65535 } });
  expect(wide.range).toEqual({ min: -32767, max: 32767 });
});

test("isWindow accepts the listed windows only", () => {
  expect(isWindow(4)).toBe(true);
  expect(isWindow(30)).toBe(true);
  expect(isWindow(5)).toBe(false);
});
