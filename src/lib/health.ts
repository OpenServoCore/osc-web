import type { Health } from "@openservocore/client";
import { FAULT_DATA_BIT, reasons, type DataState } from "./data-state";

export type Level = "fault" | "warn" | "ok";

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
  "Closed loop refused: the servo's data state does not allow it.",
];

/**
 * Every latched fault clears the same way: the torque_enable 0->1 edge is the
 * only ack, and until it comes the motor stays off (firmware kernel/faults.rs).
 */
const CLEAR = "The motor stays off until torque is switched off and on again.";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** The data fault names the reason it refused, not just that it did. */
function faultLine(bit: number, data: DataState | undefined): string {
  const [reason] = data === undefined ? [] : reasons(data.flags);
  if (bit === FAULT_DATA_BIT && reason !== undefined) return `Closed loop refused. ${reason.text}`;
  return FAULTS[bit] ?? `Unknown fault, bit ${bit}.`;
}

/** Worst first: faults, then unsaved changes, then the all-clear. */
export function statements(h: Health, data?: DataState): Statement[] {
  const out: Statement[] = [];
  for (let bit = 0; bit < 8; bit++) {
    if ((h.faultFlags & (1 << bit)) === 0) continue;
    out.push({ level: "fault", text: `${faultLine(bit, data)} ${CLEAR}` });
  }
  if (h.configDirty) {
    out.push({ level: "warn", text: "Unsaved changes: settings differ from the saved ones." });
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
