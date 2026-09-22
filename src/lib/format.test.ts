import { expect, test } from "vitest";
import { formatBaud, formatVersion, hex16 } from "./format";

test("formatVersion joins major.minor.patch", () => {
  expect(formatVersion([1, 2, 3])).toBe("1.2.3");
  expect(formatVersion([0, 0, 0])).toBe("0.0.0");
});

test("hex16 zero-pads to four digits", () => {
  expect(hex16(0x0101)).toBe("0x0101");
  expect(hex16(0)).toBe("0x0000");
  expect(hex16(0xffff)).toBe("0xffff");
});

test("formatBaud renders megabaud", () => {
  expect(formatBaud("b500000")).toBe("0.5 M");
  expect(formatBaud("b1000000")).toBe("1 M");
  expect(formatBaud("b2000000")).toBe("2 M");
  expect(formatBaud("b3000000")).toBe("3 M");
});
