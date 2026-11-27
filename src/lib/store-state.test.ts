import { expect, test } from "vitest";
import { MODES } from "./control";
import {
  DEFAULTS,
  NOT_SAVED,
  REFUSED,
  defaults,
  refusal,
  refuses,
  warnings,
  type StoreState,
} from "./store-state";

const UNSAVED = 1 << 0;
const CONFIG_DEFAULTS = 1 << 1;
const CALIB_DEFAULTS = 1 << 2;
const KE_UNSET = 0b1100;
const LIMITS_UNSET = 0b1110;

const CLEAN: StoreState = { status: 0, refused: 0, faultCode: 0 };

test("each image bit names one image on its defaults; the unsaved bit names none", () => {
  expect(defaults(0)).toEqual([]);
  expect(defaults(UNSAVED)).toEqual([]);
  expect(defaults(CALIB_DEFAULTS)).toEqual(["CALIB_DEFAULTS"]);
  expect(defaults(0xff)).toEqual(["CONFIG_DEFAULTS", "CALIB_DEFAULTS"]);
});

test("a refused bit refuses the mode of that value, and nothing else does", () => {
  for (const { name } of MODES) expect(refuses(name, CLEAN), name).toBe(false);
  const ke = { ...CLEAN, refused: KE_UNSET };
  expect(MODES.map((m) => refuses(m.name, ke))).toEqual([false, false, true, true]);
  const limits = { ...CLEAN, refused: LIMITS_UNSET };
  expect(MODES.map((m) => refuses(m.name, limits))).toEqual([false, true, true, true]);
});

test("the refused bits name the constant: Current refused means the limits, else Ke", () => {
  const limits = { ...CLEAN, refused: LIMITS_UNSET };
  expect(refusal("OpenLoop", limits)).toBeUndefined();
  for (const mode of ["Current", "Velocity", "Position"] as const) {
    expect(refusal(mode, limits), mode).toMatch(/current cap or the speed ceiling is unset/);
  }
  const ke = { ...CLEAN, refused: KE_UNSET };
  expect(refusal("Current", ke)).toBeUndefined();
  expect(refusal("Velocity", ke)).toMatch(/Ke is unset/);
  expect(refusal("Position", ke)).toMatch(/Ke is unset/);
});

test("one warning per case, the refusal first, then the defaults, then unsaved changes", () => {
  expect(warnings(CLEAN)).toEqual([]);
  expect(
    warnings({
      status: CONFIG_DEFAULTS | CALIB_DEFAULTS | UNSAVED,
      refused: LIMITS_UNSET,
      faultCode: 0,
    }).map((w) => w.kind),
  ).toEqual(["refused", "defaults", "unsaved"]);
  expect(warnings({ ...CLEAN, status: CONFIG_DEFAULTS })).toEqual([
    { kind: "defaults", text: DEFAULTS },
  ]);
  expect(warnings({ ...CLEAN, status: UNSAVED })).toEqual([{ kind: "unsaved", text: NOT_SAVED }]);
  expect(DEFAULTS).toMatch(/^Settings not identified \(defaults\): run an identification/);
});

test("a latched refusal on constants that no longer refuse still warns, in general words", () => {
  expect(warnings({ ...CLEAN, faultCode: 7 })).toEqual([{ kind: "refused", text: REFUSED }]);
  expect(warnings({ ...CLEAN, refused: KE_UNSET, faultCode: 7 })[0]?.text).toMatch(/Ke is unset/);
});
