import { expect, test } from "vitest";
import { closedLoopAllowed, headline, openLoopAllowed, reasons } from "./data-state";

const CONFIG_VIRGIN = 1 << 0;
const CONFIG_CORRUPT = 1 << 1;
const CALIB_VIRGIN = 1 << 2;
const CALIB_CORRUPT = 1 << 3;
const STAMP_MISMATCH = 1 << 4;
const PLANT_UNSET = 1 << 5;
const CONFIG_STALE = 1 << 6;
const CALIB_STALE = 1 << 7;

test("every bit is one reason and they come most urgent first", () => {
  expect(reasons(0)).toEqual([]);
  expect(reasons(0xff).map((r) => r.name)).toEqual([
    "CONFIG_CORRUPT",
    "CALIB_CORRUPT",
    "CONFIG_STALE",
    "CALIB_STALE",
    "CONFIG_VIRGIN",
    "CALIB_VIRGIN",
    "STAMP_MISMATCH",
    "PLANT_UNSET",
  ]);
  expect(reasons(PLANT_UNSET | CALIB_STALE | STAMP_MISMATCH).map((r) => r.name)).toEqual([
    "CALIB_STALE",
    "STAMP_MISMATCH",
    "PLANT_UNSET",
  ]);
});

test("a factory-fresh servo reads as never set up, with the next step", () => {
  const [first] = reasons(CONFIG_VIRGIN | CALIB_VIRGIN | STAMP_MISMATCH | PLANT_UNSET);
  expect(first?.text).toBe(
    "Closed loop is off: this servo has never been set up. Run osc cal and osc ident, then save.",
  );
});

test("every reason leads with the consequence", () => {
  for (const r of reasons(0xff)) {
    expect(r.text, r.name).toMatch(/^(Closed loop is off|Torque is refused): /);
  }
  expect(reasons(CALIB_STALE)[0]?.text).toContain("from another firmware");
  expect(reasons(CALIB_CORRUPT)[0]?.text).toContain("unreadable");
  expect(reasons(CONFIG_CORRUPT)[0]?.text).toContain("Factory reset");
});

test("the entry verdict mirrors the kernel: corrupt config refuses all, anything else the closed loops", () => {
  expect(closedLoopAllowed(0)).toBe(true);
  expect(openLoopAllowed(0)).toBe(true);
  for (let bit = 0; bit < 8; bit++) {
    expect(closedLoopAllowed(1 << bit), `bit ${bit}`).toBe(false);
    expect(openLoopAllowed(1 << bit), `bit ${bit}`).toBe(bit !== 1);
  }
  expect(openLoopAllowed(CONFIG_STALE | PLANT_UNSET)).toBe(true);
  expect(openLoopAllowed(CONFIG_CORRUPT | PLANT_UNSET)).toBe(false);
});

test("the headline is the urgent reason, marked when the kernel refused an enable", () => {
  expect(headline({ flags: 0, faultCode: 0 })).toBeUndefined();
  expect(headline({ flags: 0, faultCode: 7 })).toBeUndefined();
  expect(headline({ flags: PLANT_UNSET, faultCode: 0 })).toBe(
    "Closed loop is off: the motor has not been identified. Run osc ident, then save.",
  );
  expect(headline({ flags: PLANT_UNSET, faultCode: 7 })).toBe(
    "Closed loop refused. Closed loop is off: the motor has not been identified. Run osc ident, then save.",
  );
});
