import { expect, test } from "vitest";
import { features, identityFrom, IDENTITY_REGISTERS } from "./identity";

test("identityFrom reads the four identity registers", () => {
  const table = new Map([
    ["model_number", 0x0101],
    ["firmware_version", 0x0100],
    ["hardware_revision", 3],
    ["capability_flags", 1],
  ]);
  const names: string[] = [];
  const read = (name: string): number => {
    names.push(name);
    const v = table.get(name);
    if (v === undefined) throw new Error(`${name} outside the read`);
    return v;
  };
  expect(identityFrom(read)).toEqual({ model: 0x0101, fw: 0x0100, hw: 3, capabilities: 1 });
  expect(new Set(names)).toEqual(new Set(IDENTITY_REGISTERS));
});

test("features names the known bits and numbers the rest", () => {
  expect(features(0)).toBe("None");
  expect(features(1)).toBe("Motor encoder");
  expect(features(0b101)).toBe("Motor encoder, bit 2");
});
