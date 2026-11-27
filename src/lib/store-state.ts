// The servo's stored state (protocol sec 5.7). `status_flags` names each image
// boot did not load, so its defaults run, and whether the table changed since
// SAVE: information that refuses nothing. `refused_modes` holds the modes the
// kernel's belt refuses now, bit = `mode` value; an enable into one latches the
// `config` fault. Pure: the bits mirror the servo core, the words are the GUI's.

import type { ModeName } from "./control";

export interface StoreState {
  /** `status_flags`. */
  status: number;
  /** `refused_modes`. */
  refused: number;
  /** `fault_code`: the latest newly-latched fault kind. */
  faultCode: number;
}

export interface Warning {
  kind: "refused" | "defaults" | "unsaved";
  /** Consequence first, then what to do about it. */
  text: string;
}

/** `status_flags` bit 0: changed since boot or the last save (protocol sec 5.7, 9.4). */
export const STATUS_UNSAVED = 1 << 0;
const IMAGES: readonly { bit: number; name: string }[] = [
  { bit: 1 << 1, name: "CONFIG_DEFAULTS" },
  { bit: 1 << 2, name: "CALIB_DEFAULTS" },
];

/** `fault_code` of an enable the belt refused. */
export const FAULT_CONFIG = 7;
/** `fault_flags` bit of the same fault. */
export const FAULT_CONFIG_BIT = 6;

const MODE_VALUE: Record<ModeName, number> = { OpenLoop: 0, Current: 1, Velocity: 2, Position: 3 };

export const DEFAULTS =
  "Settings not identified (defaults): run an identification. Run osc-ident run, then osc-ident save.";
export const NOT_SAVED = "Changes not saved: a reboot loses them.";
const LIMITS_UNSET =
  "Closed loop refused: the current cap or the speed ceiling is unset. Run an identification: osc-ident run.";
const KE_UNSET =
  "Closed loop refused: the motor's Ke is unset. Run an identification: osc-ident run.";
/** The kernel latched the `config` fault on constants that no longer refuse. */
export const REFUSED =
  "Closed loop refused: Ke, the current cap or the speed ceiling is unset. Run an identification: osc-ident run.";

/** The images on their defaults, by `status_flags` bit name. */
export function defaults(status: number): string[] {
  return IMAGES.filter((i) => (status & i.bit) !== 0).map((i) => i.name);
}

/** The belt refuses `mode` now. */
export function refuses(mode: ModeName, s: StoreState): boolean {
  return (s.refused & (1 << MODE_VALUE[mode])) !== 0;
}

/**
 * Why the belt refuses `mode`, undefined when it runs. The bits name the
 * constant: an unset cap or ceiling refuses Current too, a zero Ke only the
 * speed loops.
 */
export function refusal(mode: ModeName, s: StoreState): string | undefined {
  if (!refuses(mode, s)) return undefined;
  return refuses("Current", s) ? LIMITS_UNSET : KE_UNSET;
}

/** The refusal standing now, else the one the kernel latched; undefined when neither. */
export function refusedLine(s: StoreState): string | undefined {
  return refusal("Position", s) ?? (s.faultCode === FAULT_CONFIG ? REFUSED : undefined);
}

/** One warning per case, most urgent first; empty when nothing needs doing. */
export function warnings(s: StoreState): Warning[] {
  const out: Warning[] = [];
  const refused = refusedLine(s);
  if (refused !== undefined) out.push({ kind: "refused", text: refused });
  if (defaults(s.status).length > 0) out.push({ kind: "defaults", text: DEFAULTS });
  if ((s.status & STATUS_UNSAVED) !== 0) out.push({ kind: "unsaved", text: NOT_SAVED });
  return out;
}
