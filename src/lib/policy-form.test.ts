import {
  initSync,
  migrate,
  resolvePreview,
  validatePolicy,
  type TuningPolicy,
} from "@openservocore/client";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  accelOf,
  DEFAULT_POLICY,
  fixedFields,
  formOf,
  importPolicy,
  moveSpeedFixed,
  moveSpeedShare,
  parseShare,
  portability,
  previewOf,
  RULE_FIELDS,
  speedUpOf,
  valueAt,
  withoutRules,
  withValue,
} from "./policy-form";

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
/** The preview resistance the page shows: the record's 4.1767 ohm. */
const R_OHM = 4.18;

test("Default passes the CLI's check and is portable; the record's policy is 8 fixed", () => {
  expect(validatePolicy(DEFAULT_POLICY)).toBeUndefined();
  expect(portability(DEFAULT_POLICY)).toBe("portable");
  expect(fixedFields(RECORD_POLICY)).toHaveLength(8);
  expect(portability(RECORD_POLICY)).toBe("8 fixed");
  const one = withValue(DEFAULT_POLICY, "motion.move_speed", { deg_s: 200 });
  expect(portability(one)).toBe("1 fixed");
  expect(fixedFields(one)).toEqual(["motion.move_speed"]);
});

test("a version 0 policy imports with every value fixed, keyed by its file name", () => {
  const m = importPolicy(testdata("policy.json"), "policy.json");
  expect(m.policy.key).toBe("policy");
  expect(portability(m.policy)).toBe("8 fixed");
  expect(m.notes.join(" ")).toContain("version 0");
});

test("the rule forms go to the run, and the rest previews the record's 400, 200 and 4000", () => {
  // The CLI refuses a rule form it does not bind yet; the preview leaves those to the run.
  expect(() => resolvePreview(PROFILE, DEFAULT_POLICY, R_OHM)).toThrow(
    "does not set protection.yield by its rule yet",
  );
  const { policy, byRun } = withoutRules(DEFAULT_POLICY);
  expect([...byRun]).toEqual([...RULE_FIELDS]);
  for (const f of RULE_FIELDS) expect(valueAt(policy, f)).toBeNull();
  expect(valueAt(policy, "motion.move_speed")).toEqual({ share_of_ceiling: 0.5 });

  const p = previewOf(DEFAULT_POLICY, PROFILE, R_OHM);
  expect(p.refusal).toBeUndefined();
  expect(p.preview?.speedCeilingDegS).toBe(400);
  expect(p.preview?.values.velocity_limit_deg_s).toBe(200);
  expect(p.preview?.values.accel_limit_deg_s2).toBe(4000);
  expect(p.preview?.currentLimitA.toFixed(2)).toBe("0.92");

  const record = previewOf(RECORD_POLICY, PROFILE, R_OHM);
  expect(record.byRun.size).toBe(0);
  expect(record.preview?.values.yield).toEqual({ ma: 350 });
});

test("move speed 0.75 of the ceiling previews 300 deg/s, and the two forms convert", () => {
  const q = withValue(DEFAULT_POLICY, "motion.move_speed", { share_of_ceiling: 0.75 });
  expect(previewOf(q, PROFILE, R_OHM).preview?.values.velocity_limit_deg_s).toBe(300);
  expect(moveSpeedFixed(0.75, 400)).toBe(300);
  expect(moveSpeedShare(300, 400)).toBe(0.75);
  expect(accelOf(200, 0.05)).toBeCloseTo(4000, 9);
  expect(speedUpOf(200, 4000)).toBeCloseTo(0.05, 12);

  const over = withValue(DEFAULT_POLICY, "motion.move_speed", { deg_s: 500 });
  const line = previewOf(over, PROFILE, R_OHM).preview?.report.fields.find(
    (l) => l.field === "motion.move_speed",
  );
  expect(line?.clamp).toContain("over the 400 deg/s speed ceiling");
});

test("a share of the no-load speed reads as a ratio or a decimal, over 0 and at most 1", () => {
  expect(parseShare("2/3")).toEqual([2, 3]);
  expect(parseShare(" 3 / 4 ")).toEqual([3, 4]);
  expect(parseShare("0.8")).toEqual([800, 1000]);
  expect(parseShare("4/3")).toBeUndefined();
  expect(parseShare("0")).toBeUndefined();
  expect(parseShare("abc")).toBeUndefined();
});

test("a value's form is its one key", () => {
  expect(formOf({ share_of_ceiling: 0.5 })).toEqual({ tag: "share_of_ceiling", amount: 0.5 });
  expect(formOf({ torque_kg_cm: null })).toEqual({ tag: "torque_kg_cm", amount: null });
  expect(formOf(null)).toBeUndefined();
  const cleared: TuningPolicy = withValue(DEFAULT_POLICY, "sensor.pot_jump", null);
  expect(cleared.sensor?.pot_jump).toBeNull();
  expect(cleared.sensor?.bad_samples).toBe(4);
});
