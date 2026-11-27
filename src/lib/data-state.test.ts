import { expect, test } from "vitest";
import { DEFAULTS, REFUSED, headline, reasons, refusal, type Belt } from "./data-state";
import { MODES } from "./control";

const CONFIG_VIRGIN = 1 << 0;
const CONFIG_CORRUPT = 1 << 1;
const CALIB_VIRGIN = 1 << 2;
const CALIB_CORRUPT = 1 << 3;
const CONFIG_STALE = 1 << 6;
const CALIB_STALE = 1 << 7;

const SET: Belt = { recipKeQ: 3700, keVpcQ: 1150, currentLimitCounts: 1043, speedCeilingCps: 8050 };

test("every image bit is one reason and they come most urgent first", () => {
  expect(reasons(0)).toEqual([]);
  expect(reasons(0xff).map((r) => r.name)).toEqual([
    "CONFIG_CORRUPT",
    "CALIB_CORRUPT",
    "CONFIG_STALE",
    "CALIB_STALE",
    "CONFIG_VIRGIN",
    "CALIB_VIRGIN",
  ]);
  expect(reasons(0x30)).toEqual([]);
  expect(reasons(CALIB_VIRGIN | CALIB_STALE).map((r) => r.name)).toEqual([
    "CALIB_STALE",
    "CALIB_VIRGIN",
  ]);
});

test("every image reason gives the one warning: defaults run until an identification", () => {
  for (const r of reasons(CONFIG_VIRGIN | CONFIG_CORRUPT | CALIB_CORRUPT | CONFIG_STALE)) {
    expect(r.text, r.name).toBe(DEFAULTS);
  }
  expect(DEFAULTS).toMatch(/^Settings not identified \(defaults\): run an identification/);
});

test("the belt refuses on a zero only: the limits refuse every closed mode, Ke the speed loops", () => {
  for (const { name } of MODES) {
    expect(refusal(name, SET), name).toBeUndefined();
  }
  for (const zero of [{ currentLimitCounts: 0 }, { speedCeilingCps: 0 }]) {
    const belt = { ...SET, ...zero };
    expect(refusal("OpenLoop", belt)).toBeUndefined();
    for (const mode of ["Current", "Velocity", "Position"] as const) {
      expect(refusal(mode, belt), mode).toMatch(/current cap or the speed ceiling is unset/);
    }
  }
  for (const zero of [{ recipKeQ: 0 }, { keVpcQ: 0 }]) {
    const belt = { ...SET, ...zero };
    expect(refusal("OpenLoop", belt)).toBeUndefined();
    expect(refusal("Current", belt)).toBeUndefined();
    expect(refusal("Velocity", belt)).toMatch(/Ke is unset/);
    expect(refusal("Position", belt)).toMatch(/Ke is unset/);
  }
  expect(refusal("Position", { ...SET, recipKeQ: 1, speedCeilingCps: 1 })).toBeUndefined();
});

test("the headline is the refusal when the kernel latched one, else the defaults warning", () => {
  const belt = SET;
  expect(headline({ flags: 0, faultCode: 0, belt })).toBeUndefined();
  expect(headline({ flags: CONFIG_VIRGIN, faultCode: 0, belt })).toBe(DEFAULTS);
  expect(headline({ flags: 0, faultCode: 7, belt })).toBe(REFUSED);
  expect(headline({ flags: CALIB_CORRUPT, faultCode: 7, belt })).toBe(REFUSED);
});
