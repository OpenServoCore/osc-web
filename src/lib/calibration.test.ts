import type { Field } from "@openservocore/client";
import { expect, test } from "vitest";
import descriptor from "../../../open-servo-core/descriptors/osc-servo/0.1.json";
import { CALIBRATION_REGISTERS, editReason, withEdit } from "./calibration";
import { editText, fieldKind, formatValue, parseInput, toRaw, type NumberKind } from "./edit";
import { calibrationFromTable, calibrationStatus, type Calibration } from "./units";

const fields = descriptor.fields as Field[];

const CAL: Calibration = {
  rawMin: 118,
  rawMax: 3990,
  angleMinCdeg: -9500,
  angleMaxCdeg: 9500,
  gearRatioCenti: 29000,
};

function kindOf(name: string): NumberKind {
  const reg = CALIBRATION_REGISTERS.find((r) => r.name === name);
  const field = fields.find((f) => f.name === name);
  if (reg === undefined || field === undefined) throw new Error(`no ${name}`);
  const kind = fieldKind(field);
  if (kind.kind !== "number") throw new Error(`${name} is not a number`);
  return { ...kind, ...reg.display };
}

test("the register list covers the five calibration registers once each", () => {
  const read = (name: string) => {
    const reg = CALIBRATION_REGISTERS.find((r) => r.name === name);
    if (reg === undefined) throw new Error(`no ${name}`);
    return CAL[reg.key];
  };
  expect(calibrationFromTable(read)).toEqual(CAL);
  expect(new Set(CALIBRATION_REGISTERS.map((r) => r.key)).size).toBe(5);
});

test("each register's value survives the trip through its display scale", () => {
  for (const reg of CALIBRATION_REGISTERS) {
    const kind = kindOf(reg.name);
    const raw = CAL[reg.key];
    const parsed = parseInput(kind, editText(kind, raw));
    expect(parsed.ok, reg.name).toBe(true);
    if (parsed.ok) expect(toRaw(kind, parsed.value), reg.name).toBe(raw);
  }
});

test("angles read in degrees, sensor ends in counts, the gear ratio as a plain ratio", () => {
  expect(formatValue(kindOf("angle_min_cdeg"), -9500)).toBe("-95.00 deg");
  expect(formatValue(kindOf("raw_max"), 3990)).toBe("3990 counts");
  expect(formatValue(kindOf("gear_ratio_centi"), 29000)).toBe("290.00");
});

test("withEdit replaces just the named register", () => {
  expect(withEdit(CAL, "raw_max", 4000)).toEqual({ ...CAL, rawMax: 4000 });
  expect(withEdit(CAL, "gear_ratio_centi", 100)).toEqual({ ...CAL, gearRatioCenti: 100 });
  expect(() => withEdit(CAL, "pos", 1)).toThrow("pos");
});

test("an edit that breaks validity carries the predicate's reason", () => {
  const broken = { ...CAL, rawMin: 4000 };
  expect(editReason(CAL, "raw_min", 4000)).toBe(calibrationStatus(broken).reason);
  expect(editReason(CAL, "raw_min", 4000)).toMatch(/below/);
  expect(editReason(CAL, "angle_max_cdeg", CAL.angleMinCdeg)).toMatch(/differ/);
});

test("a valid edit passes without a reason", () => {
  expect(editReason(CAL, "raw_max", 4000)).toBeUndefined();
  expect(editReason(CAL, "angle_min_cdeg", -18000)).toBeUndefined();
});

test("an edit is judged on the failures it adds, not the ones already there", () => {
  const unset: Calibration = {
    rawMin: 0,
    rawMax: 0,
    angleMinCdeg: 0,
    angleMaxCdeg: 0,
    gearRatioCenti: 0,
  };
  expect(calibrationStatus(unset).valid).toBe(false);
  expect(editReason(unset, "raw_max", 4000)).toBeUndefined();
  expect(editReason(unset, "raw_max", 4096)).toMatch(/inside/);
  expect(editReason({ ...unset, rawMax: 4000 }, "raw_min", 4100)).toMatch(/below/);
});
