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
 * One sample in device counts: `velocity` and `goalVelocity` are counts/s,
 * `goalDuty` q15, `dutyTicks` PWM compare counts, `modeActive` the `mode`
 * enum's discriminant, `t` seconds.
 */
export interface Sample {
  t: number;
  pos: number;
  /** `pos_lut_state`: the kernel linearizes `pos` only while it reads LIVE. */
  posLutState: number;
  goal: number;
  goalVelocity: number;
  goalCurrent: number;
  goalDuty: number;
  dutyTicks: number;
  modeActive: number;
  velocity: number;
  current: number;
  vbus: number;
  /**
   * `vdiff_counts`, the kernel's drive-window differential: a poll of the two
   * taps can land while the next scan holds them in sample order (protocol
   * sec 5.6).
   */
  vdiff: number;
  ntc: number;
  windingCc: number;
}

export interface TelemetryConfig {
  sense: Sense;
  cal: Calibration;
  biases: Biases;
  /** Full scale of `duty_ticks`. */
  pwmPeriodTicks: number;
}

export const SAMPLE_REGISTERS: readonly string[] = [
  "goal_duty",
  "goal_position",
  "goal_velocity",
  "goal_current",
  "mode_active",
  "omega_hat_cps",
  "duty_ticks",
  "pos_lut_state",
  "pos",
  "current_raw",
  "vdiff_counts",
  "vbus_raw",
  "ntc_raw",
  "t_winding_cc",
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
  "pwm_period_ticks",
];
export const BIAS_REGISTERS: readonly string[] = registersOf(biasesFromTable);

export function decodeSample(read: ReadRegister, t: number): Sample {
  return {
    t,
    pos: read("pos"),
    posLutState: read("pos_lut_state"),
    goal: read("goal_position"),
    goalVelocity: read("goal_velocity"),
    goalCurrent: read("goal_current"),
    goalDuty: read("goal_duty"),
    dutyTicks: read("duty_ticks"),
    modeActive: read("mode_active"),
    velocity: read("omega_hat_cps") / Q16,
    current: read("current_raw"),
    vbus: read("vbus_raw"),
    vdiff: read("vdiff_counts"),
    ntc: read("ntc_raw"),
    windingCc: read("t_winding_cc"),
  };
}

/** The conversion constants, from one read over CONFIG_REGISTERS and BIAS_REGISTERS. */
export function configFrom(read: ReadRegister): TelemetryConfig {
  return {
    sense: senseFromTable(read),
    cal: calibrationFromTable(read),
    biases: biasesFromTable(read),
    pwmPeriodTicks: read("pwm_period_ticks"),
  };
}
