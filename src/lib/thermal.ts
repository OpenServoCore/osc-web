// The winding estimate's telemetry (firmware core estimator/thermal.rs)
// and the CONFIG cutoff the over temperature fault latches at
// (regions/config.rs).

import type { ReadRegister } from "./units";

/** `t_winding_cc` while the estimate is unset (thermal.rs `UNSET_CC`). */
export const UNSET_CC = -32768;

/** `therm_flags` bits (thermal.rs `flag`); bits 2-7 are reserved. */
const UNSET = 1 << 0;
const NTC_FAULT = 1 << 1;

export const THERMAL_REGISTERS: readonly string[] = [
  "cutoff_cc",
  "t_winding_cc",
  "t_ntc_cc",
  "therm_flags",
];

export interface Thermal {
  windingCc: number;
  ntcCc: number;
  flags: number;
  cutoffCc: number;
}

export function thermalFrom(read: ReadRegister): Thermal {
  return {
    windingCc: read("t_winding_cc"),
    ntcCc: read("t_ntc_cc"),
    flags: read("therm_flags"),
    cutoffCc: read("cutoff_cc"),
  };
}

export function celsius(cc: number): number {
  return cc / 100;
}

/** The winding in C, NaN while the estimate reads its sentinel. */
export function windingC(cc: number): number {
  return cc === UNSET_CC ? NaN : celsius(cc);
}

export function thermOff(t: Thermal): boolean {
  return (t.flags & UNSET) !== 0 || t.windingCc === UNSET_CC;
}

/**
 * The board sensor reads a rail or a temperature outside its band: the
 * winding reads over every cutoff and the board holds its last good value,
 * so neither is a temperature.
 */
export function sensorFault(t: Thermal): boolean {
  return (t.flags & NTC_FAULT) !== 0;
}
