import { describe, expect, test } from "vitest";
import { formatQuantity } from "./format";
import {
  celsius,
  sensorFault,
  thermalFrom,
  thermOff,
  UNSET_CC,
  windingC,
  type Thermal,
} from "./thermal";
import { DISPLAY } from "./units";

const warm: Thermal = {
  windingCc: 3141,
  ntcCc: 2437,
  flags: 0,
  cutoffCc: 9000,
};

const c = (cc: number) => formatQuantity(celsius(cc), DISPLAY.temperature);

describe("centi-C to C", () => {
  test.each([
    [3141, "31.4 C"],
    [3149, "31.5 C"],
    [2500, "25.0 C"],
    [0, "0.0 C"],
    [-4, "0.0 C"],
    [-1250, "-12.5 C"],
    [32767, "327.7 C"],
  ])("%i cc reads %s", (cc, text) => {
    expect(c(cc)).toBe(text);
  });

  test("the sentinel is no temperature", () => {
    expect(windingC(UNSET_CC)).toBeNaN();
    expect(formatQuantity(windingC(UNSET_CC), DISPLAY.temperature)).toBe("n/a");
    expect(windingC(-32767)).toBe(-327.67);
  });
});

describe("therm_flags", () => {
  test.each([
    [0, false],
    [1 << 0, true],
    [1 << 1, false],
    [1 << 2, false],
    [1 << 3, false],
    [1 << 4, false],
    [1 << 5, false],
    [1 << 6, false],
    [1 << 7, false],
    [0xff, true],
  ])("flags %i read off: %j", (flags, off) => {
    expect(thermOff({ ...warm, flags })).toBe(off);
  });

  test("the sentinel reads off even with the flag clear", () => {
    expect(thermOff({ ...warm, windingCc: UNSET_CC })).toBe(true);
  });

  test.each([
    [0, false],
    [1 << 0, false],
    [1 << 1, true],
    [1 << 2, false],
    [1 << 7, false],
    [0xff, true],
  ])("flags %i read a sensor fault: %j", (flags, fault) => {
    expect(sensorFault({ ...warm, flags })).toBe(fault);
  });

  test("a saturated estimate with the flag clear is no sensor fault", () => {
    expect(sensorFault({ ...warm, windingCc: 32767 })).toBe(false);
  });
});

test("thermalFrom reads every thermal register by name", () => {
  const values: Record<string, number> = {
    t_winding_cc: 3141,
    t_ntc_cc: 2437,
    therm_flags: 0,
    cutoff_cc: 9000,
  };
  expect(thermalFrom((name) => values[name] ?? NaN)).toEqual(warm);
});
