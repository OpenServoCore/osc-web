// The winding estimate's telemetry (firmware core estimator/thermal.rs)
// and the CONFIG thresholds the current limit derates against
// (kernel/limits.rs).

import type { ReadRegister } from "./units";

/** `t_winding_cc` while the estimate is unset (thermal.rs `UNSET_CC`). */
export const UNSET_CC = -32768;

/** `therm_flags` bit 0 (thermal.rs `flag`); bits 1-7 are reserved. */
const UNSET = 1 << 0;

export const THERMAL_REGISTERS: readonly string[] = [
  "current_limit_counts",
  "derate_start_cc",
  "cutoff_cc",
  "i_lim_counts",
  "t_winding_cc",
  "t_ntc_cc",
  "therm_flags",
];

export interface Thermal {
  windingCc: number;
  ntcCc: number;
  flags: number;
  iLimCounts: number;
  currentLimitCounts: number;
  derateStartCc: number;
  cutoffCc: number;
}

export function thermalFrom(read: ReadRegister): Thermal {
  return {
    windingCc: read("t_winding_cc"),
    ntcCc: read("t_ntc_cc"),
    flags: read("therm_flags"),
    iLimCounts: read("i_lim_counts"),
    currentLimitCounts: read("current_limit_counts"),
    derateStartCc: read("derate_start_cc"),
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

export type ThermLevel = "warn" | "notice";

export interface ThermState {
  word: string;
  level: ThermLevel;
}

export function thermOff(t: Thermal): boolean {
  return (t.flags & UNSET) !== 0 || t.windingCc === UNSET_CC;
}

/**
 * Off stands alone: an unset estimate clears every other bit. Derating is
 * the winding past derate_start with the limit actually folded under the
 * configured one, so a stall yield alone never reads as heat.
 */
export function thermStates(t: Thermal): ThermState[] {
  if (thermOff(t)) return [{ word: "off", level: "notice" }];
  const out: ThermState[] = [];
  if (t.windingCc > t.derateStartCc && t.iLimCounts < t.currentLimitCounts) {
    out.push({ word: "derating", level: "warn" });
  }
  return out;
}
