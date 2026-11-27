import type { Health } from "@openservocore/client";
import { FAULT_CONFIG_BIT, refusal, type StoreState } from "./store-state";

export type Level = "fault" | "ok";

export interface Statement {
  level: Level;
  text: string;
}

/** `fault_flags` bit order (protocol sec 5.3 alarm register). */
const FAULTS: readonly string[] = [
  "Over current: the drive pulled more than its current limit.",
  "Over temperature: the winding estimate reached the cutoff.",
  "Stalled: holding current with no movement.",
  "Position error: the servo stayed away from its goal for too long.",
  "Sensor fault: the position readings jumped further than a step can.",
  "Under voltage: the bus rail sagged below the limit.",
  "Closed loop refused: Ke, the current cap or the speed ceiling is unset.",
];

/**
 * Every latched fault clears the same way: the torque_enable 0->1 edge is the
 * only ack, and until it comes the motor stays off (firmware kernel/faults.rs).
 */
const CLEAR = "The motor stays off until torque is switched off and on again.";

/**
 * The Live page's line under the torque switch. A motion fault re-latches the
 * moment torque returns if the goal still drives into the stop; the config
 * fault is about the servo's constants, not where it is.
 */
export function latchedLine(faultFlags: number, goalAtStop: boolean): string {
  const motion = (faultFlags & ~(1 << FAULT_CONFIG_BIT)) !== 0;
  return motion && goalAtStop
    ? "Motor is off: a fault is latched. Move the goal away from the stop, then switch torque off and on."
    : "Motor is off: a fault is latched. Switch torque off and on to clear it.";
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** The config fault names the constant the belt refused on, not just that it did. */
function faultLine(bit: number, store: StoreState | undefined): string {
  const reason = store === undefined ? undefined : refusal("Position", store);
  if (bit === FAULT_CONFIG_BIT && reason !== undefined) return reason;
  return FAULTS[bit] ?? `Unknown fault, bit ${bit}.`;
}

/** The latched faults, lowest bit first, else the all-clear; unsaved changes are the stored-state banner's. */
export function statements(h: Health, store?: StoreState): Statement[] {
  const out: Statement[] = [];
  for (let bit = 0; bit < 8; bit++) {
    if ((h.faultFlags & (1 << bit)) === 0) continue;
    out.push({ level: "fault", text: `${faultLine(bit, store)} ${CLEAR}` });
  }
  if (h.faultFlags === 0) out.push({ level: "ok", text: "No faults." });
  return out;
}

export function trimLine(h: Health): string {
  const sign = h.trimSteps > 0 ? "+" : "";
  const unit = Math.abs(h.trimSteps) === 1 ? "step" : "steps";
  return `Clock trim ${sign}${h.trimSteps} ${unit}`;
}

export function countersLine(h: Health): string {
  return `${plural(h.crcFailCount, "CRC error")}, ${plural(h.framingDropCount, "dropped frame")}`;
}
