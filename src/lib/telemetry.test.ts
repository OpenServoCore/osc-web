import type { Field } from "@openservocore/client";
import { expect, test } from "vitest";
import descriptor from "../../../open-servo-core/descriptors/osc-servo/0.1.json";
import { decodeSpan, planSpans } from "./bus/spans";
import {
  BIAS_REGISTERS,
  CONFIG_REGISTERS,
  configFrom,
  decodeSample,
  registersOf,
  SAMPLE_REGISTERS,
} from "./telemetry";

const fields = descriptor.fields as Field[];

test("the sample registers plan one read, goal_duty through t_winding_cc", () => {
  expect(planSpans(fields, SAMPLE_REGISTERS)).toEqual([{ addr: 390, count: 224 }]);
});

test("the conversion registers plan one read each side of the table", () => {
  expect(planSpans(fields, CONFIG_REGISTERS)).toEqual([{ addr: 160, count: 48 }]);
  expect(planSpans(fields, BIAS_REGISTERS)).toEqual([{ addr: 620, count: 4 }]);
});

test("registersOf lists what a binder reads, in order", () => {
  expect(registersOf((read) => [read("x"), read("y")])).toEqual(["x", "y"]);
});

test("decodeSample scales omega_hat_cps out of Q16 and keeps the rest in counts", () => {
  const span = { addr: 390, count: 224 };
  const bytes = new Uint8Array(span.count);
  const view = new DataView(bytes.buffer);
  const at = (name: string) => {
    const f = fields.find((x) => x.name === name);
    if (f === undefined) throw new Error(name);
    return f.addr - span.addr;
  };
  view.setInt16(at("goal_duty"), -1000, true);
  view.setInt32(at("goal_position"), 2048, true);
  view.setInt32(at("goal_velocity"), -500, true);
  view.setInt16(at("goal_current"), 250, true);
  view.setUint8(at("mode_active"), 3);
  view.setInt32(at("omega_hat_cps"), -3 * 65536, true);
  view.setInt16(at("duty_ticks"), -900, true);
  view.setUint16(at("pos"), 1234, true);
  view.setUint8(at("pos_lut_state"), 2);
  view.setUint16(at("current_raw"), 300, true);
  view.setInt16(at("vdiff_counts"), -100, true);
  view.setUint16(at("vbus_raw"), 3600, true);
  view.setUint16(at("ntc_raw"), 2000, true);
  view.setInt16(at("t_winding_cc"), -3141, true);
  expect(decodeSample(decodeSpan(fields, span, bytes), 1.5)).toEqual({
    t: 1.5,
    pos: 1234,
    posLutState: 2,
    goal: 2048,
    goalVelocity: -500,
    goalCurrent: 250,
    goalDuty: -1000,
    dutyTicks: -900,
    modeActive: 3,
    velocity: -3,
    current: 300,
    vbus: 3600,
    vdiff: -100,
    ntc: 2000,
    windingCc: -3141,
  });
});

test("configFrom binds the sense, the calibration, the biases and the PWM period from one reader", () => {
  const values: Record<string, number> = {
    shunt_r_mohm: 10,
    gain_milli: 32000,
    vdd_mv: 3300,
    raw_min: 200,
    raw_max: 3800,
    angle_min_cdeg: 0,
    angle_max_cdeg: 18000,
    gear_ratio_centi: 100,
    current_bias_counts: 2048,
    vmotor_bias_counts: 1024,
    pwm_period_ticks: 1200,
  };
  const config = configFrom((name) => values[name] ?? 1);
  expect(config.sense.shuntMohm).toBe(10);
  expect(config.cal.rawMax).toBe(3800);
  expect(config.biases.currentBiasCounts).toBe(2048);
  expect(config.pwmPeriodTicks).toBe(1200);
});
