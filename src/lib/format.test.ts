import { expect, test } from "vitest";
import {
  fixed,
  formatBaud,
  formatQuantity,
  formatVersion,
  hex16,
  hexAddr,
  unitSymbol,
  withUnit,
} from "./format";

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
  expect(formatQuantity(123.456, { unit: "deg", digits: 1 })).toBe("123.5°");
  expect(formatQuantity(4.9876, { unit: "V", digits: 2 })).toBe("4.99 V");
  expect(formatQuantity(12.4, { unit: "mA", digits: 0 })).toBe("12 mA");
});

test("formatQuantity never shows a negative zero", () => {
  expect(formatQuantity(-0.04, { unit: "deg", digits: 1 })).toBe("0.0°");
  expect(formatQuantity(-0.4, { unit: "mA", digits: 0 })).toBe("0 mA");
});

test("formatQuantity reads n/a for a value the chain cannot express", () => {
  expect(formatQuantity(NaN, { unit: "C", digits: 1 })).toBe("n/a");
});

test("formatQuantity writes a temperature in degrees C after a space", () => {
  expect(formatQuantity(31.44, { unit: "C", digits: 1 })).toBe("31.4 °C");
});

test("unitSymbol shows the ASCII units with their symbols", () => {
  expect(unitSymbol("deg")).toBe("°");
  expect(unitSymbol("deg/s")).toBe("°/s");
  expect(unitSymbol("deg/s^2")).toBe("°/s²");
  expect(unitSymbol("C")).toBe("°C");
  expect(unitSymbol("degC")).toBe("°C");
  expect(unitSymbol("C/W")).toBe("°C/W");
  expect(unitSymbol("0.01 C")).toBe("0.01 °C");
  expect(unitSymbol("0.01 deg")).toBe("0.01°");
  expect(unitSymbol("s/60 deg")).toBe("s/60°");
  expect(unitSymbol("ohm")).toBe("Ω");
  expect(unitSymbol("mOhm")).toBe("mΩ");
  expect(unitSymbol("us")).toBe("µs");
  expect(unitSymbol("uV s/rad")).toBe("µV s/rad");
  expect(unitSymbol("kg m^2")).toBe("kg m²");
  expect(unitSymbol("x0.01")).toBe("×0.01");
  expect(unitSymbol("x100")).toBe("×100");
  expect(unitSymbol("x the electrical corner")).toBe("× the electrical corner");
});

test("unitSymbol leaves every other unit as written", () => {
  for (const u of ["", "V", "mA", "V s/rad", "mS", "counts/s", "kg cm", "Hz", "of the rail", "°"]) {
    expect(unitSymbol(u)).toBe(u);
  }
});

test("withUnit closes an angle and a multiplier up to the number", () => {
  expect(withUnit("12.3", "deg")).toBe("12.3°");
  expect(withUnit("200", "deg/s")).toBe("200°/s");
  expect(withUnit("0.5", "x")).toBe("0.5×");
  expect(withUnit("4.0988", "ohm")).toBe("4.0988 Ω");
  expect(withUnit("25.0", "C")).toBe("25.0 °C");
  expect(withUnit("1.5", "")).toBe("1.5");
});
