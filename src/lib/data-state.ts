// The servo's data state (protocol sec 5.7): `data_flags` names every saved
// image the servo did not load, so board defaults run in its place. It is
// information and refuses nothing. Only the kernel's belt refuses a mode, on a
// constant a loop cannot run on: a zero Ke, current cap or speed ceiling, and
// then it latches the `data` fault. Pure: the bits mirror the servo core, the
// words are the GUI's.

import type { ModeName } from "./control";
import type { ReadRegister } from "./units";

/** The constants the belt reads, as the servo holds them now. */
export interface Belt {
  recipKeQ: number;
  keVpcQ: number;
  currentLimitCounts: number;
  speedCeilingCps: number;
}

export interface DataState {
  flags: number;
  /** `fault_code`: the latest newly-latched fault kind. */
  faultCode: number;
  belt: Belt;
}

export interface Reason {
  name: string;
  /** Consequence first, then what to do about it. */
  text: string;
}

/** `fault_code` of an enable the belt refused. */
export const FAULT_DATA = 7;
/** `fault_flags` bit of the same fault. */
export const FAULT_DATA_BIT = 6;

export const BELT_REGISTERS: readonly string[] = [
  "recip_ke_q",
  "ke_vpc_q",
  "current_limit_counts",
  "speed_ceiling_cps",
];

export function beltFrom(read: ReadRegister): Belt {
  return {
    recipKeQ: read("recip_ke_q"),
    keVpcQ: read("ke_vpc_q"),
    currentLimitCounts: read("current_limit_counts"),
    speedCeilingCps: read("speed_ceiling_cps"),
  };
}

/** Every image reason means the same to an operator: defaults run until an identification is saved. */
export const DEFAULTS =
  "Settings not identified (defaults): run an identification. Run osc-ident run, then osc-ident save.";
const LIMITS_UNSET =
  "Closed loop refused: the current cap or the speed ceiling is unset. Run an identification: osc-ident run.";
const KE_UNSET =
  "Closed loop refused: the motor's Ke is unset. Run an identification: osc-ident run.";
/** The kernel latched the `data` fault: an enable asked for a mode the belt refuses. */
export const REFUSED =
  "Closed loop refused: Ke, the current cap or the speed ceiling is unset. Run an identification: osc-ident run.";

/** Most urgent first: the order the servo core's host half reports them in. */
const REASONS: readonly { bit: number; name: string }[] = [
  { bit: 1 << 1, name: "CONFIG_CORRUPT" },
  { bit: 1 << 3, name: "CALIB_CORRUPT" },
  { bit: 1 << 6, name: "CONFIG_STALE" },
  { bit: 1 << 7, name: "CALIB_STALE" },
  { bit: 1 << 0, name: "CONFIG_VIRGIN" },
  { bit: 1 << 2, name: "CALIB_VIRGIN" },
];

/** The reasons set in `flags`, most urgent first. */
export function reasons(flags: number): Reason[] {
  return REASONS.filter((r) => (flags & r.bit) !== 0).map(({ name }) => ({ name, text: DEFAULTS }));
}

/**
 * Why the belt refuses `mode` on these constants, undefined when it runs: a
 * zero cap or ceiling refuses Current, Velocity and Position, a zero Ke
 * Velocity and Position. OpenLoop is never refused.
 */
export function refusal(mode: ModeName, belt: Belt): string | undefined {
  if (mode === "OpenLoop") return undefined;
  if (belt.currentLimitCounts === 0 || belt.speedCeilingCps === 0) return LIMITS_UNSET;
  if (mode === "Current") return undefined;
  if (belt.recipKeQ === 0 || belt.keVpcQ === 0) return KE_UNSET;
  return undefined;
}

/**
 * The banner's headline: the refusal when the kernel latched one, else the
 * defaults warning; undefined when nothing is wrong.
 */
export function headline(state: DataState): string | undefined {
  if (state.faultCode === FAULT_DATA) return REFUSED;
  return reasons(state.flags)[0]?.text;
}
