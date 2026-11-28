import type { Field } from "@openservocore/client";
import { expect, test } from "vitest";
import descriptor from "../../../open-servo-core/descriptors/osc-servo/0.1.json";
import fixture from "../../tests/fixtures/stall-24mhz.json";
import {
  clampGoal,
  CONTROL_REGISTERS,
  displayEnds,
  goalAtStop,
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
  softLimitsAfter,
  softLimitsWrite,
  travelFromTable,
  type GoalContext,
  type Limits,
} from "./control";
import { decodeSpan, planSpans } from "./bus/spans";
import type { Sample } from "./telemetry";
import { ADC_MAX_COUNT, ampsPerCount, senseFromTable, type Calibration } from "./units";

const fields = descriptor.fields as Field[];

// The recording predates the published bias divider: 0 reads as no divider.
const sense = senseFromTable((name) => {
  const v = { ...fixture.meta.sense, vmotor_bias_top_ohm: 0, vmotor_bias_bot_ohm: 0 }[name];
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
const limits: Limits = {
  travel: { min: 0, max: 4095 },
  dutyMaxQ15: 30000,
  speedCeilingCps: 4000,
  currentLimitCounts: 280,
};
const ctx: GoalContext = { cal, sense, limits, raw: false };

test("the control and limit registers plan one read each", () => {
  expect(planSpans(fields, CONTROL_REGISTERS)).toEqual([{ addr: 384, count: 18 }]);
  expect(planSpans(fields, LIMIT_REGISTERS)).toEqual([{ addr: 32, count: 46 }]);
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

test("limitsFromTable names the soft limits and the three ceilings", () => {
  const regs: Record<string, number> = {
    pos_min_phys_counts: 82,
    pos_max_phys_counts: 3792,
    pos_min_soft_counts: 0,
    pos_max_soft_counts: 4095,
    duty_max_q15: 30000,
    speed_ceiling_cps: 4000,
    current_limit_counts: 280,
  };
  expect(limitsFromTable((name) => regs[name] ?? NaN)).toEqual(limits);
});

const stops = { pos_min_phys_counts: 82, pos_max_phys_counts: 3792 };
const reader =
  (regs: Record<string, number>) =>
  (name: string): number => {
    const v = regs[name];
    if (v === undefined) throw new Error(`no ${name}`);
    return v;
  };

test("soft limits of 0 / 0 are off: the travel is the physical stops", () => {
  const off = reader({ ...stops, pos_min_soft_counts: 0, pos_max_soft_counts: 0 });
  expect(travelFromTable(off)).toEqual({ min: 82, max: 3792 });
  expect(
    limitsFromTable(
      reader({
        ...stops,
        pos_min_soft_counts: 0,
        pos_max_soft_counts: 0,
        duty_max_q15: 0,
        speed_ceiling_cps: 0,
        current_limit_counts: 0,
      }),
    ).travel,
  ).toEqual({ min: 82, max: 3792 });
  const on = reader({ ...stops, pos_min_soft_counts: 314, pos_max_soft_counts: 3560 });
  expect(travelFromTable(on)).toEqual({ min: 314, max: 3560 });
  // one side 0 is a pair like any other, judged by the servo as before
  const oneSide = reader({ ...stops, pos_min_soft_counts: 0, pos_max_soft_counts: 3560 });
  expect(travelFromTable(oneSide)).toEqual({ min: 0, max: 3560 });
});

test("a goal is judged by the physical stops while the soft limits are off", () => {
  const off = {
    ...limits,
    travel: travelFromTable(reader({ ...stops, pos_min_soft_counts: 0, pos_max_soft_counts: 0 })),
  };
  expect(goalAtStop(2000, cal, off)).toBe(false);
  expect(goalAtStop(300, cal, off)).toBe(false);
  expect(goalAtStop(3792, cal, off)).toBe(true);
  expect(goalAtStop(82, swapped, off)).toBe(true);
  expect(goalAtStop(83, swapped, off)).toBe(false);
});

test("an edit of one soft limit carries the other side as stored, or its stop while off", () => {
  const on = reader({ ...stops, pos_min_soft_counts: 314, pos_max_soft_counts: 3560 });
  expect(softLimitsAfter("pos_min_soft_counts", 400, on)).toEqual({ min: 400, max: 3560 });
  expect(softLimitsAfter("pos_max_soft_counts", 3000, on)).toEqual({ min: 314, max: 3000 });
  const off = reader({ ...stops, pos_min_soft_counts: 0, pos_max_soft_counts: 0 });
  expect(softLimitsAfter("pos_min_soft_counts", 400, off)).toEqual({ min: 400, max: 3792 });
  expect(softLimitsAfter("pos_max_soft_counts", 3000, off)).toEqual({ min: 82, max: 3000 });
  expect(softLimitsAfter("pos_min_phys_counts", 90, on)).toBeUndefined();
});

test("the soft limits go as one write of both sides, low first", () => {
  expect(softLimitsWrite({ min: 0, max: 0 })).toEqual([
    ["pos_min_soft_counts", { kind: "int", value: 0 }],
    ["pos_max_soft_counts", { kind: "int", value: 0 }],
  ]);
  const [lo, hi] = ["pos_min_soft_counts", "pos_max_soft_counts"].map((n) =>
    fields.find((f) => f.name === n),
  );
  expect(lo !== undefined && hi !== undefined && lo.addr + lo.width === hi.addr).toBe(true);
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

test("a goal at or past either end of the calibrated span is at a stop", () => {
  expect(goalAtStop(200, cal, limits)).toBe(true);
  expect(goalAtStop(150, cal, limits)).toBe(true);
  expect(goalAtStop(201, cal, limits)).toBe(false);
  expect(goalAtStop(3799, cal, limits)).toBe(false);
  expect(goalAtStop(3800, cal, limits)).toBe(true);
  expect(goalAtStop(4000, cal, limits)).toBe(true);
});

test("soft limits inside the calibrated span are the stops the goal is judged by", () => {
  const soft = { ...limits, travel: { min: 1000, max: 3000 } };
  expect(goalAtStop(1000, cal, soft)).toBe(true);
  expect(goalAtStop(1001, cal, soft)).toBe(false);
  expect(goalAtStop(2999, cal, soft)).toBe(false);
  expect(goalAtStop(3000, cal, soft)).toBe(true);
});

test("an unusable calibration judges the goal by the soft limits and the ADC", () => {
  expect(goalAtStop(150, swapped, limits)).toBe(false);
  expect(goalAtStop(0, swapped, limits)).toBe(true);
  expect(goalAtStop(ADC_MAX_COUNT, swapped, limits)).toBe(true);
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

test("a descending angle map reads its goal ends lowest degree first, the slider inverted", () => {
  // degrees counterclockwise-positive on a pot whose counts rise clockwise
  const ccwLow: Calibration = { ...cal, angleMinCdeg: 18000, angleMaxCdeg: 0 };
  const deg = goalSpec("Position", { ...ctx, cal: ccwLow });
  expect(deg.range).toEqual({ min: 200, max: 3800 });
  expect(deg.fromDisplay(135)).toBe(1100);
  expect(displayEnds(deg)).toEqual({ low: 3800, high: 200, inverted: true });
  expect(displayEnds(goalSpec("Position", ctx))).toEqual({ low: 200, high: 3800, inverted: false });
  const vel = goalSpec("Velocity", { ...ctx, cal: ccwLow });
  expect(vel.fromDisplay(50)).toBe(-1000);
  expect(displayEnds(vel)).toEqual({ low: 4000, high: -4000, inverted: true });
  const raw = goalSpec("Position", { ...ctx, cal: ccwLow, raw: true });
  expect(displayEnds(raw).inverted).toBe(false);
});

// Identification writes the map about the center of travel (protocol sec
// 5.5): 0 deg at the stops' midpoint, the ends +/- half the travel.
test("on a centered map a goal of 0 deg is the center and the goals read signed", () => {
  const centered: Calibration = { ...cal, angleMinCdeg: -9000, angleMaxCdeg: 9000 };
  const deg = goalSpec("Position", { ...ctx, cal: centered });
  expect(deg.fromDisplay(0)).toBe(2000);
  expect(deg.fromDisplay(-45)).toBe(1100);
  expect(deg.toDisplay(2900)).toBeCloseTo(45, 6);
  expect(displayEnds(deg)).toEqual({ low: 200, high: 3800, inverted: false });
  expect([deg.toDisplay(200), deg.toDisplay(3800)]).toEqual([-90, 90]);
  // Counts rising clockwise: the map descends, counterclockwise stays positive.
  const ccwLow: Calibration = { ...cal, angleMinCdeg: 9000, angleMaxCdeg: -9000 };
  const down = goalSpec("Position", { ...ctx, cal: ccwLow });
  expect(down.fromDisplay(0)).toBe(2000);
  expect(down.fromDisplay(45)).toBe(1100);
  expect(displayEnds(down)).toEqual({ low: 3800, high: 200, inverted: true });
});

test("the velocity goal is deg/s over the speed ceiling, counts/s in raw mode", () => {
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
