import { initSync, migrate, type TuningPolicy } from "@openservocore/client";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  countDirection,
  isServoCopy,
  MIN_TURN_COUNTS,
  readiness,
  servoCopyKey,
  usedBy,
} from "./ident-setup";
import type { InputRef, ServoSetup } from "./library";
import { DEFAULT_POLICY, WARN, withValue } from "./policy-form";
import { NOT_METAL } from "./profile-form";

initSync({
  module: readFileSync(
    new URL("../../../open-servo-core/client/web/pkg/osc_client_web_bg.wasm", import.meta.url),
  ),
});

const testdata = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(`../../../open-servo-core/measure/testdata/mg90-d/${name}`, import.meta.url),
      "utf8",
    ),
  );

const PROFILE = migrate(testdata("profile.json"), undefined).profile;
const RECORD_POLICY = migrate(testdata("profile.json"), testdata("policy-of-record.json")).policy;

const YIELD_NOT_YET =
  'This tool does not set protection.yield by its rule yet (a max yield torque over the stated stall torque, times the stated volts over R), so the run would leave it as the servo holds it: state it fixed, as {"ma": ...}';

test("no profile chosen blocks the run before anything else", () => {
  expect(readiness(undefined, RECORD_POLICY)).toEqual({ blocker: { kind: "no-profile" } });
});

test("the record's profile and policy are ready", () => {
  expect(readiness(PROFILE, RECORD_POLICY)).toEqual({ warning: undefined });
});

test("Default is refused with the CLI's words, and the plain line says to copy it and fix its six rules", () => {
  const r = readiness(PROFILE, DEFAULT_POLICY);
  expect(r.blocker).toEqual({
    kind: "refused",
    text: YIELD_NOT_YET,
    plain:
      "Identify stays off until the policy states its 6 rule-bound values as fixed numbers; Default cannot change, so copy it for this servo and fix them on Tuning policies.",
  });
});

test("a user copy with one rule left names the next refusal and needs no copy", () => {
  let policy: TuningPolicy = { ...RECORD_POLICY, key: "arm-joints" };
  policy = withValue(policy, "loops.observer", { multiple_of_mechanical_corner: 1.9 });
  const r = readiness(PROFILE, policy);
  expect(r.blocker).toEqual({
    kind: "refused",
    text: expect.stringContaining(
      "This tool does not set loops.observer by its rule yet",
    ) as string,
    plain:
      "Identify stays off until the policy states its one rule-bound value as a fixed number; fix it on Tuning policies.",
  });
});

test("an incomplete profile names its first missing field with the run's sentence", () => {
  const r = readiness({ ...PROFILE, gear_ratio: null, travel_deg: null }, RECORD_POLICY);
  expect(r.blocker).toEqual({
    kind: "missing",
    field: "gear_ratio",
    text: expect.stringContaining(
      "Without the gear ratio the run cannot turn motor turns into horn degrees",
    ) as string,
  });
  const counts = readiness({ ...PROFILE, brushes: null }, RECORD_POLICY);
  expect(counts.blocker).toMatchObject({ kind: "missing", field: "counts" });
});

test("a plastic train is refused first: no field it lacks would make it identifiable", () => {
  const r = readiness({ ...PROFILE, gear_class: "plastic", gear_ratio: null }, RECORD_POLICY);
  expect(r.blocker).toEqual({ kind: "not-metal", text: NOT_METAL });
  expect(readiness({ ...PROFILE, gear_class: "unknown" }, RECORD_POLICY).blocker).toEqual({
    kind: "not-metal",
    text: NOT_METAL,
  });
});

test("a run voltage over the profile's range warns and never blocks", () => {
  const at = (v: number) => withValue(RECORD_POLICY, "protection.run_v", v);
  expect(readiness(PROFILE, at(7))).toEqual({ warning: WARN.runV });
  expect(readiness(PROFILE, at(6.6))).toEqual({ warning: undefined });
  expect(readiness({ ...PROFILE, gear_ratio: null }, at(7)).warning).toBe(WARN.runV);
});

test("a copy for one servo is keyed by the uid's tail, the key cut to fit", () => {
  const uid = "00000000c94b8419d1092aec87de5fd1";
  expect(servoCopyKey("default", uid)).toBe("default-87de5fd1");
  const long = servoCopyKey("a-very-long-policy-key-for-the-arm-joints", uid);
  expect(long).toBe("a-very-long-policy-key-for-the-87de5fd1");
  expect(long.length).toBeLessThanOrEqual(40);
  expect(isServoCopy("default-87de5fd1", uid)).toBe(true);
  expect(isServoCopy("default", uid)).toBe(false);
});

test("used by names the servos on the bus by ID and counts the rest", () => {
  const ref = (key: string): InputRef => ({ key, revision: 1, sha256: "00" });
  const setups = new Map<string, ServoSetup>([
    ["u2", { profile: ref("vorpal-mg90"), policy: null }],
    ["u1", { profile: ref("vorpal-mg90"), policy: null }],
    ["u3", { profile: ref("vorpal-mg90"), policy: null }],
    ["u4", { profile: ref("towerpro-sg90"), policy: null }],
    ["u5", { profile: null, policy: ref("default") }],
  ]);
  const ids = new Map([
    ["u1", 1],
    ["u2", 12],
    ["u4", 3],
  ]);
  const idOf = (uid: string) => ids.get(uid);
  expect(usedBy("vorpal-mg90", setups, idOf)).toBe("used by ID 1, ID 12, 1 servo not on the bus");
  expect(usedBy("towerpro-sg90", setups, idOf)).toBe("used by ID 3");
  expect(usedBy("towerpro-sg90", setups, () => undefined)).toBe("used by 1 servo not on the bus");
  expect(usedBy("other", setups, idOf)).toBeUndefined();
});

test("the hand turn reads the count direction from the reading's sign, once it moved enough", () => {
  expect(countDirection(1900, 1900 + MIN_TURN_COUNTS)).toEqual({ risesCcw: true });
  expect(countDirection(1900, 1900 - MIN_TURN_COUNTS)).toEqual({ risesCcw: false });
  expect(countDirection(1900, 2400)).toEqual({ risesCcw: true });
  expect(countDirection(1900, 1900 + MIN_TURN_COUNTS - 1)).toEqual({ short: MIN_TURN_COUNTS - 1 });
  expect(countDirection(1900, 1880)).toEqual({ short: 20 });
});
