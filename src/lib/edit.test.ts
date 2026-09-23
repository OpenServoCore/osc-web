import type { Field } from "@openservocore/client";
import { describe, expect, test } from "vitest";
import {
  editText,
  fieldKind,
  formatValue,
  fromRaw,
  parseInput,
  rangeHint,
  toRaw,
  toValue,
  type NumberKind,
} from "./edit";

const id: Field = {
  name: "id",
  addr: 16,
  width: 1,
  access: "rw",
  kind: "uint",
  min: 1,
  max: 249,
  variants: [],
};
const chans: Field = {
  name: "chans",
  addr: 410,
  width: 1,
  access: "rw",
  kind: "uint",
  max: 7,
  variants: [],
};
const goal: Field = {
  name: "goal_position",
  addr: 392,
  width: 4,
  access: "rw",
  kind: "int",
  variants: [],
};
const mode: Field = {
  name: "mode",
  addr: 388,
  width: 1,
  access: "rw",
  kind: "enum",
  variants: [
    { name: "OpenLoop", value: 0 },
    { name: "Current", value: 1 },
    { name: "Velocity", value: 2 },
    { name: "Position", value: 3 },
  ],
};
const torque: Field = {
  name: "torque_enable",
  addr: 384,
  width: 1,
  access: "rw",
  kind: "bool",
  variants: [],
};
const words: Field = {
  name: "words",
  addr: 640,
  width: 4,
  access: "rw",
  kind: "bytes",
  variants: [],
};

const deg: NumberKind = { kind: "number", signed: true, width: 2, scale: 0.01, unit: "deg" };

describe("fieldKind", () => {
  test("numbers carry signedness, width and the descriptor bounds", () => {
    expect(fieldKind(id)).toEqual({ kind: "number", signed: false, width: 1, min: 1, max: 249 });
    expect(fieldKind(chans)).toEqual({ kind: "number", signed: false, width: 1, max: 7 });
    expect(fieldKind(goal)).toEqual({ kind: "number", signed: true, width: 4 });
  });

  test("enums list the variants as labelled options", () => {
    expect(fieldKind(mode)).toEqual({
      kind: "enum",
      options: [
        { label: "OpenLoop", value: 0 },
        { label: "Current", value: 1 },
        { label: "Velocity", value: 2 },
        { label: "Position", value: 3 },
      ],
    });
  });

  test("bool and bytes", () => {
    expect(fieldKind(torque)).toEqual({ kind: "bool" });
    expect(fieldKind(words)).toEqual({ kind: "raw", width: 4 });
  });
});

describe("parseInput number", () => {
  const kind = fieldKind(id);

  test("accepts values at the bounds", () => {
    expect(parseInput(kind, "1")).toEqual({ ok: true, value: 1 });
    expect(parseInput(kind, " 249 ")).toEqual({ ok: true, value: 249 });
  });

  test("rejects values outside the descriptor bounds", () => {
    expect(parseInput(kind, "0")).toEqual({ ok: false, reason: "between 1 and 249" });
    expect(parseInput(kind, "250")).toEqual({ ok: false, reason: "between 1 and 249" });
  });

  test("falls back to the width range when the descriptor gives no bound", () => {
    expect(parseInput(fieldKind(chans), "0")).toEqual({ ok: true, value: 0 });
    expect(parseInput(fieldKind(chans), "8")).toEqual({ ok: false, reason: "between 0 and 7" });
    expect(parseInput(fieldKind(goal), "-2147483648")).toEqual({ ok: true, value: -2147483648 });
    expect(parseInput(fieldKind(goal), "2147483647")).toEqual({ ok: true, value: 2147483647 });
    expect(parseInput(fieldKind(goal), "2147483648")).toEqual({
      ok: false,
      reason: "between -2147483648 and 2147483647",
    });
  });

  test("rejects empty, non-numeric and fractional input", () => {
    expect(parseInput(kind, "")).toEqual({ ok: false, reason: "enter a number" });
    expect(parseInput(kind, "abc")).toEqual({ ok: false, reason: "not a number" });
    expect(parseInput(kind, "1.5")).toEqual({ ok: false, reason: "whole numbers only" });
  });

  test("scaled input must land on a count", () => {
    expect(parseInput(deg, "1.23")).toEqual({ ok: true, value: 1.23 });
    expect(parseInput(deg, "1.234")).toEqual({ ok: false, reason: "steps of 0.01 deg" });
    expect(parseInput(deg, "400")).toEqual({
      ok: false,
      reason: "between -327.68 and 327.67 deg",
    });
  });
});

describe("parseInput enum, bool, raw", () => {
  test("enum matches an option value", () => {
    expect(parseInput(fieldKind(mode), "2")).toEqual({ ok: true, value: 2 });
    expect(parseInput(fieldKind(mode), "9")).toEqual({ ok: false, reason: "pick an option" });
  });

  test("bool", () => {
    expect(parseInput(fieldKind(torque), "true")).toEqual({ ok: true, value: true });
    expect(parseInput(fieldKind(torque), "false")).toEqual({ ok: true, value: false });
    expect(parseInput(fieldKind(torque), "yes")).toEqual({ ok: false, reason: "on or off" });
  });

  test("raw hex must be exactly the field width", () => {
    const kind = fieldKind(words);
    expect(parseInput(kind, "de ad BE ef")).toEqual({
      ok: true,
      value: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
    });
    expect(parseInput(kind, "deadbe")).toEqual({ ok: false, reason: "4 bytes as hex" });
    expect(parseInput(kind, "deadbeef00")).toEqual({ ok: false, reason: "4 bytes as hex" });
    expect(parseInput(kind, "zz")).toEqual({ ok: false, reason: "hex digits only" });
  });
});

describe("formatValue", () => {
  test("number, enum, bool, raw", () => {
    expect(formatValue(fieldKind(id), 7)).toBe("7");
    expect(formatValue(deg, 123)).toBe("1.23 deg");
    expect(formatValue(deg, -5)).toBe("-0.05 deg");
    expect(formatValue(fieldKind(mode), 3)).toBe("Position");
    expect(formatValue(fieldKind(mode), 9)).toBe("9");
    expect(formatValue(fieldKind(torque), true)).toBe("On");
    expect(formatValue(fieldKind(torque), false)).toBe("Off");
    expect(formatValue(fieldKind(words), new Uint8Array([0, 15, 255, 16]))).toBe("00 0f ff 10");
  });
});

describe("rangeHint", () => {
  test("only from descriptor bounds", () => {
    expect(rangeHint(fieldKind(id) as NumberKind)).toBe("1 to 249");
    expect(rangeHint(fieldKind(chans) as NumberKind)).toBe("at most 7");
    expect(rangeHint(fieldKind(goal) as NumberKind)).toBeUndefined();
    expect(rangeHint({ ...deg, min: -9000, max: 9000 })).toBe("-90.00 deg to 90.00 deg");
  });
});

describe("round trips", () => {
  test("toRaw and fromRaw invert through the scale", () => {
    expect(toRaw(deg, 1.23)).toBe(123);
    expect(fromRaw(deg, 123)).toBeCloseTo(1.23);
    expect(toRaw(deg, fromRaw(deg, -32768))).toBe(-32768);
    const counts = fieldKind(goal) as NumberKind;
    expect(toRaw(counts, 42)).toBe(42);
    expect(fromRaw(counts, 42)).toBe(42);
  });

  test("editText parses back to the value it came from", () => {
    expect(parseInput(fieldKind(id), editText(fieldKind(id), 249))).toEqual({
      ok: true,
      value: 249,
    });
    expect(editText(deg, 123)).toBe("1.23");
    expect(toRaw(deg, (parseInput(deg, editText(deg, 123)) as { value: number }).value)).toBe(123);
    expect(parseInput(fieldKind(mode), editText(fieldKind(mode), 2))).toEqual({
      ok: true,
      value: 2,
    });
    expect(parseInput(fieldKind(torque), editText(fieldKind(torque), true))).toEqual({
      ok: true,
      value: true,
    });
    const bytes = new Uint8Array([1, 2, 3, 4]);
    expect(parseInput(fieldKind(words), editText(fieldKind(words), bytes))).toEqual({
      ok: true,
      value: bytes,
    });
  });
});

test("toValue tags a parsed edit by the field's kind and rejects a mismatch", () => {
  expect(toValue(id, 7)).toEqual({ kind: "uint", value: 7 });
  expect(toValue(goal, -3)).toEqual({ kind: "int", value: -3 });
  expect(toValue(mode, 2)).toEqual({ kind: "enum", value: 2 });
  expect(toValue(torque, true)).toEqual({ kind: "bool", value: true });
  const bytes = new Uint8Array([1, 2, 3, 4]);
  expect(toValue(words, bytes)).toEqual({ kind: "bytes", value: bytes });
  expect(() => toValue(torque, 1)).toThrow("torque_enable is bool, not number");
});
