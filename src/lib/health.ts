import type { Health } from "@openservocore/client";

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
];

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Worst first: faults, then unsaved changes, then the all-clear. */
export function statements(h: Health): Statement[] {
  const out: Statement[] = [];
  for (let bit = 0; bit < 8; bit++) {
    if ((h.faultFlags & (1 << bit)) === 0) continue;
    out.push({ level: "fault", text: FAULTS[bit] ?? `Unknown fault, bit ${bit}.` });
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
