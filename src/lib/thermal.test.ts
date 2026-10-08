import { describe, expect, test } from "vitest";
import { formatQuantity } from "./format";
import { celsius, thermalFrom, thermStates, UNSET_CC, windingC, type Thermal } from "./thermal";
import { DISPLAY } from "./units";

const warm: Thermal = {
  windingCc: 3141,
  ntcCc: 2437,
  flags: 0,
  iLimCounts: 280,
  currentLimitCounts: 280,
  derateStartCc: 8000,
  cutoffCc: 10000,
  recoverCc: 9000,
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
    [0, []],
    [1 << 0, ["off"]],
    [1 << 1, []],
    [1 << 2, ["check cold R"]],
    [1 << 3, []],
    [1 << 4, []],
    [1 << 5, []],
    [1 << 6, []],
    [1 << 7, []],
    [(1 << 2) | (1 << 3), ["check cold R"]],
    [0xff, ["off"]],
  ])("flags %i states %j", (flags, words) => {
    expect(thermStates({ ...warm, flags }).map((s) => s.word)).toEqual(words);
  });

  test("the sentinel reads off even with the flag clear", () => {
    expect(thermStates({ ...warm, windingCc: UNSET_CC })).toEqual([
      { word: "off", level: "notice" },
    ]);
  });

  test("derating is the winding past the start with the limit folded under", () => {
    const hot = { ...warm, windingCc: 9000, iLimCounts: 140 };
    expect(thermStates(hot)).toEqual([{ word: "derating", level: "warn" }]);
    expect(thermStates({ ...hot, iLimCounts: 280 })).toEqual([]);
    expect(thermStates({ ...hot, windingCc: 8000 })).toEqual([]);
    expect(thermStates({ ...warm, iLimCounts: 60 })).toEqual([]);
    expect(thermStates({ ...hot, flags: 1 << 2 }).map((s) => s.word)).toEqual([
      "derating",
      "check cold R",
    ]);
  });
});

test("thermalFrom reads every thermal register by name", () => {
  const values: Record<string, number> = {
    t_winding_cc: 3141,
    t_ntc_cc: 2437,
    therm_flags: 0,
    i_lim_counts: 280,
    current_limit_counts: 280,
    derate_start_cc: 8000,
    cutoff_cc: 10000,
    recover_cc: 9000,
  };
  expect(thermalFrom((name) => values[name] ?? NaN)).toEqual(warm);
});
