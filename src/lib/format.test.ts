import { expect, test } from "vitest";
import { fixed, formatBaud, formatQuantity, formatVersion, hex16, hexAddr } from "./format";

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

test("hexAddr zero-pads to three digits", () => {
  expect(hexAddr(0x20)).toBe("0x020");
  expect(hexAddr(0x3ff)).toBe("0x3ff");
});

test("fixed writes a value that rounds to zero without a sign", () => {
  expect(fixed(-0.04, 1)).toBe("0.0");
  expect(fixed(-0.004, 2)).toBe("0.00");
  expect(fixed(-0.4, 0)).toBe("0");
  expect(fixed(-0.06, 1)).toBe("-0.1");
});

test("formatQuantity rounds to the display digits with the unit", () => {
  expect(formatQuantity(123.456, { unit: "deg", digits: 1 })).toBe("123.5 deg");
  expect(formatQuantity(4.9876, { unit: "V", digits: 2 })).toBe("4.99 V");
  expect(formatQuantity(12.4, { unit: "mA", digits: 0 })).toBe("12 mA");
});

test("formatQuantity never shows a negative zero", () => {
  expect(formatQuantity(-0.04, { unit: "deg", digits: 1 })).toBe("0.0 deg");
  expect(formatQuantity(-0.4, { unit: "mA", digits: 0 })).toBe("0 mA");
});

test("formatQuantity reads n/a for a value the chain cannot express", () => {
  expect(formatQuantity(NaN, { unit: "C", digits: 1 })).toBe("n/a");
});
