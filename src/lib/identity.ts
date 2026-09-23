import type { Identity } from "@openservocore/client";
import type { ReadRegister } from "./units";

/** CONFIG-COMMON front: what a servo says about itself, read once per servo. */
export const IDENTITY_REGISTERS: readonly string[] = [
  "model_number",
  "firmware_version",
  "hardware_revision",
  "capability_flags",
];

export function identityFrom(read: ReadRegister): Identity {
  return {
    model: read("model_number"),
    fw: read("firmware_version"),
    hw: read("hardware_revision"),
    capabilities: read("capability_flags"),
  };
}

/** `capability_flags` bit order (protocol sec 5.4). */
const CAPABILITIES: readonly string[] = ["Motor encoder"];

export function features(caps: number): string {
  const set: string[] = [];
  for (let bit = 0; bit < 32; bit++) {
    if ((caps & (1 << bit)) === 0) continue;
    set.push(CAPABILITIES[bit] ?? `bit ${bit}`);
  }
  return set.length === 0 ? "None" : set.join(", ");
}
