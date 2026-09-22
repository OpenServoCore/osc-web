import { expect, test } from "vitest";
import { formatVersion, hex16 } from "./format";

test("formatVersion joins major.minor.patch", () => {
  expect(formatVersion([1, 2, 3])).toBe("1.2.3");
  expect(formatVersion([0, 0, 0])).toBe("0.0.0");
});

test("hex16 zero-pads to four digits", () => {
  expect(hex16(0x0101)).toBe("0x0101");
  expect(hex16(0)).toBe("0x0000");
  expect(hex16(0xffff)).toBe("0xffff");
});
