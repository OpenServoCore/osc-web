// The Live page's telemetry: the registers one fast subscription carries, the
// conversion registers behind them, and the decode from a snapshot's reader.

import {
  biasesFromTable,
  calibrationFromTable,
  senseFromTable,
  type Biases,
  type Calibration,
  type ReadRegister,
  type Sense,
} from "./units";

/** The nominal rate of the bus manager's fast class, which the header prints. */
export const POLL_HZ = 10;
/** omega_hat_cps is csQ16, (counts/s) x 2^16 (firmware regions/telemetry.rs). */
const Q16 = 2 ** 16;

/**
 * One sample in device counts: `velocity` and `goalVelocity` are counts/s, the
 * duties q15, `modeActive` the `mode` enum's discriminant, `t` seconds.
 */
export interface Sample {
  t: number;
  pos: number;
  goal: number;
  goalVelocity: number;
  goalCurrent: number;
  goalDuty: number;
  dutyApplied: number;
  modeActive: number;
  velocity: number;
  current: number;
  vbus: number;
  vmotorA: number;
  vmotorB: number;
  ntc: number;
}

export interface TelemetryConfig {
  sense: Sense;
  cal: Calibration;
  biases: Biases;
}

export const SAMPLE_REGISTERS: readonly string[] = [
  "goal_duty",
  "goal_position",
  "goal_velocity",
  "goal_current",
  "mode_active",
  "omega_hat_cps",
  "duty_applied_q15",
  "pos",
  "current",
  "vmotor_a",
  "vmotor_b",
  "vbus_raw",
  "ntc_raw",
];

/** The registers a units binder reads, so the list lives in one place. */
export function registersOf(binder: (read: ReadRegister) => unknown): string[] {
  const names: string[] = [];
  binder((name) => {
    names.push(name);
    return 0;
  });
  return names;
}

export const CONFIG_REGISTERS: readonly string[] = [
  ...registersOf(senseFromTable),
  ...registersOf(calibrationFromTable),
];
export const BIAS_REGISTERS: readonly string[] = registersOf(biasesFromTable);

export function decodeSample(read: ReadRegister, t: number): Sample {
  return {
    t,
    pos: read("pos"),
    goal: read("goal_position"),
    goalVelocity: read("goal_velocity"),
    goalCurrent: read("goal_current"),
    goalDuty: read("goal_duty"),
    dutyApplied: read("duty_applied_q15"),
    modeActive: read("mode_active"),
    velocity: read("omega_hat_cps") / Q16,
    current: read("current"),
    vbus: read("vbus_raw"),
    vmotorA: read("vmotor_a"),
    vmotorB: read("vmotor_b"),
    ntc: read("ntc_raw"),
  };
}

/** The conversion constants, from one read over CONFIG_REGISTERS and BIAS_REGISTERS. */
export function configFrom(read: ReadRegister): TelemetryConfig {
  return {
    sense: senseFromTable(read),
    cal: calibrationFromTable(read),
    biases: biasesFromTable(read),
  };
}
