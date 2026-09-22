import type { NumberDisplay } from "./edit";
import { calibrationIssues, type Calibration } from "./units";

export interface CalibrationRegister {
  name: string;
  key: keyof Calibration;
  label: string;
  display: NumberDisplay;
}

/** In card order: sensor and angle endpoints side by side, then the gearing. */
export const CALIBRATION_REGISTERS: readonly CalibrationRegister[] = [
  { name: "raw_min", key: "rawMin", label: "Sensor lowest", display: { unit: "counts" } },
  {
    name: "angle_min_cdeg",
    key: "angleMinCdeg",
    label: "Angle lowest",
    display: { scale: 0.01, unit: "deg" },
  },
  { name: "raw_max", key: "rawMax", label: "Sensor highest", display: { unit: "counts" } },
  {
    name: "angle_max_cdeg",
    key: "angleMaxCdeg",
    label: "Angle highest",
    display: { scale: 0.01, unit: "deg" },
  },
  {
    name: "gear_ratio_centi",
    key: "gearRatioCenti",
    label: "Gear ratio",
    display: { scale: 0.01 },
  },
];

/** The calibration as it would stand with register `name` holding `raw`. */
export function withEdit(cal: Calibration, name: string, raw: number): Calibration {
  const reg = CALIBRATION_REGISTERS.find((r) => r.name === name);
  if (reg === undefined) throw new Error(`${name} is not a calibration register`);
  return { ...cal, [reg.key]: raw };
}

/**
 * The first check `raw` in `name` would newly fail, or nothing. Only new
 * failures count: a fresh block is all zeros, so no single edit can make it
 * valid and refusing every edit that leaves it invalid would lock it there.
 */
export function editReason(cal: Calibration, name: string, raw: number): string | undefined {
  const before = new Set(calibrationIssues(cal));
  return calibrationIssues(withEdit(cal, name, raw)).find((reason) => !before.has(reason));
}
