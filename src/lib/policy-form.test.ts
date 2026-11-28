import { initSync, migrate, validatePolicy, type TuningPolicy } from "@openservocore/client";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  accelOf,
  CENTER_OFFSET,
  DEFAULT_POLICY,
  fixedFields,
  formOf,
  importPolicy,
  moveSpeedFixed,
  moveSpeedShare,
  parseShare,
  portability,
  previewOf,
  retiredCwStop,
  retiredSoftMargin,
  RULE_FIELDS,
  SOFT_TRAVEL,
  speedUpOf,
  withCenterOffset,
  withSoftTravel,
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

test("Default previews its rule forms as set by the run, and the record's 400, 200 and 4000", () => {
  const p = previewOf(DEFAULT_POLICY, PROFILE, R_OHM);
  expect(p.refusal).toBeUndefined();
  expect([...p.byRun]).toEqual([...RULE_FIELDS]);
  const line = (f: string) => p.preview?.report.fields.find((l) => l.field === f);
  expect(line("protection.yield")).toMatchObject({ form: "share", value: "the cap" });
  for (const f of RULE_FIELDS.filter((f) => f !== "protection.yield")) {
    expect(line(f)?.form, f).toBe("share");
    expect(line(f)?.note, f).toMatch(/set by the run$/);
  }
  expect(p.preview?.values.yield).toEqual({ torque_kg_cm: null });
  expect(p.preview?.values.current_loop).toEqual({ multiple_of_electrical_corner: 1.25 });
  expect(p.preview?.speedCeilingDegS).toBe(400);
  expect(p.preview?.values.velocity_limit_deg_s).toBe(200);
  expect(p.preview?.values.accel_limit_deg_s2).toBe(4000);
  expect(p.preview?.currentLimitA.toFixed(2)).toBe("0.92");

  const record = previewOf(RECORD_POLICY, PROFILE, R_OHM);
  expect(record.byRun.size).toBe(0);
  expect(record.preview?.values.yield).toEqual({ ma: 350 });
});

test("a plastic train needs its plastic torque limit, and a yield torque over it needs the checkbox", () => {
  const plastic = { ...PROFILE, gear_class: "plastic" as const };
  expect(previewOf(DEFAULT_POLICY, plastic, R_OHM).refusal).toContain(
    "the plastic torque limit, the yield torque of a plastic train, is not known yet",
  );
  const limited = withValue(DEFAULT_POLICY, "protection.plastic_torque_limit_kg_cm", 1.2);
  const at = previewOf(limited, plastic, R_OHM);
  expect(at.refusal).toBeUndefined();
  expect(at.preview?.report.fields.find((l) => l.field === "protection.yield")?.note).toMatch(
    /^the plastic torque limit, over the 1.8 kg cm stall torque at 4.8 V/,
  );
  const over = withValue(limited, "protection.yield", { torque_kg_cm: 1.5 });
  expect(previewOf(over, plastic, R_OHM).refusal).toContain(
    "a yield torque of 1.5 kg cm is over the plastic torque limit, 1.2 kg cm, and above_plastic_limit is not true",
  );
  const above = withValue(over, "protection.above_plastic_limit", true);
  expect(previewOf(above, plastic, R_OHM).refusal).toBeUndefined();
});

test("a rule share or a yield torque of 0 or under is refused", () => {
  const share = withValue(DEFAULT_POLICY, "protection.stall_release", { share_of_yield: 0 });
  expect(validatePolicy(share)).toContain(
    "A share or a multiple of 0 or under sets nothing the servo can run on: the policy's protection.stall_release is 0",
  );
  expect(previewOf(share, PROFILE, R_OHM).refusal).toBe(validatePolicy(share));
  const torque = withValue(DEFAULT_POLICY, "protection.yield", { torque_kg_cm: 0 });
  expect(validatePolicy(torque)).toContain("A yield torque of 0 or under would read as the cap");
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

test("the soft travel is the profile's rated travel unless the policy states its own", () => {
  expect(valueOf(DEFAULT_POLICY)).toBeUndefined();
  const line = (q: TuningPolicy) =>
    previewOf(q, PROFILE, R_OHM).preview?.report.fields.find((l) => l.field === SOFT_TRAVEL);
  expect(line(DEFAULT_POLICY)).toMatchObject({ form: "profile", value: 180 });
  // none stated stays none in the values, so the rules name the profile's rated travel
  expect(
    previewOf(DEFAULT_POLICY, PROFILE, R_OHM).preview?.values.soft_travel_deg ?? null,
  ).toBeNull();
  const narrow = withSoftTravel(DEFAULT_POLICY, "120");
  if ("error" in narrow) throw new Error(narrow.error);
  expect(line(narrow)).toMatchObject({ form: "stated", value: 120 });
  const wide = withSoftTravel(DEFAULT_POLICY, "200");
  expect("error" in wide).toBe(false);
  for (const bad of ["0", "-5", "361"]) {
    const e = withSoftTravel(DEFAULT_POLICY, bad);
    expect("error" in e && e.error, bad).toMatch(/the policy's motion\.soft_travel_deg is/);
  }
  const blank = withSoftTravel(narrow, "");
  if ("error" in blank) throw new Error(blank.error);
  expect(line(blank)).toMatchObject({ form: "profile", value: 180 });
});

test("a policy stored with the soft margin share is refused naming the soft travel, and an entry takes it out", () => {
  const stored = {
    ...DEFAULT_POLICY,
    key: "arm-joints",
    motion: { ...DEFAULT_POLICY.motion, soft_margin_share: 0 },
  } as TuningPolicy;
  const retired = retiredSoftMargin(stored);
  expect(retired).toMatch(
    /^the policy states motion\.soft_margin_share, which this tool no longer reads/,
  );
  expect(retired).toContain("motion.soft_travel_deg");
  expect(validatePolicy(stored)).toBe(retired);
  expect(retiredSoftMargin(DEFAULT_POLICY)).toBeUndefined();
  const fixed = withSoftTravel(stored, "");
  if ("error" in fixed) throw new Error(fixed.error);
  expect("soft_margin_share" in (fixed.motion ?? {})).toBe(false);
  expect(validatePolicy(fixed)).toBeUndefined();
});

test("Default states no center offset and no CW stop angle: 0 deg is the center of travel", () => {
  expect("angle_cw_stop_deg" in (DEFAULT_POLICY.motion ?? {})).toBe(false);
  expect(DEFAULT_POLICY.motion?.center_offset_deg).toBeUndefined();
  const line = (q: TuningPolicy) =>
    previewOf(q, PROFILE, R_OHM).preview?.report.fields.find((l) => l.field === CENTER_OFFSET);
  expect(line(DEFAULT_POLICY)).toMatchObject({ form: "stated", value: 0 });
  expect(line(DEFAULT_POLICY)?.note).toBe(
    "0 deg at the center of travel, the policy stating no offset",
  );
  const tuned = withCenterOffset(DEFAULT_POLICY, "-12.5");
  if ("error" in tuned) throw new Error(tuned.error);
  expect(tuned.motion?.center_offset_deg).toBe(-12.5);
  expect(validatePolicy(tuned)).toBeUndefined();
  expect(line(tuned)).toMatchObject({ value: -12.5 });
  expect(line(tuned)?.note).toMatch(/the run clamps it to the furthest the soft window fits/);
  const blank = withCenterOffset(tuned, "");
  if ("error" in blank) throw new Error(blank.error);
  expect(line(blank)).toMatchObject({ value: 0 });
  for (const bad of ["east", "1e400"]) {
    expect("error" in withCenterOffset(DEFAULT_POLICY, bad), bad).toBe(true);
  }
});

test("a policy stored with the CW stop angle is refused naming the center offset, and an entry takes it out", () => {
  const stored = {
    ...DEFAULT_POLICY,
    key: "arm-joints",
    motion: { ...DEFAULT_POLICY.motion, angle_cw_stop_deg: 0 },
  } as TuningPolicy;
  const retired = retiredCwStop(stored);
  expect(retired).toMatch(
    /^the policy states motion\.angle_cw_stop_deg, which this tool no longer reads: 0 deg is the servo's center of travel/,
  );
  expect(retired).toContain("motion.center_offset_deg");
  expect(validatePolicy(stored)).toBe(retired);
  expect(previewOf(stored, PROFILE, R_OHM).refusal).toBe(retired);
  expect(retiredCwStop(DEFAULT_POLICY)).toBeUndefined();
  for (const text of ["", "2"]) {
    const fixed = withCenterOffset(stored, text);
    if ("error" in fixed) throw new Error(fixed.error);
    expect("angle_cw_stop_deg" in (fixed.motion ?? {})).toBe(false);
    expect(validatePolicy(fixed)).toBeUndefined();
  }
});

test("a version 0 policy's CW stop angle imports as a note, not a value", () => {
  const v0 = { ...(testdata("policy.json") as Record<string, unknown>), angle_cw_stop_deg: 0 };
  const m = importPolicy(v0, "policy.json");
  expect("angle_cw_stop_deg" in (m.policy.motion ?? {})).toBe(false);
  expect(m.policy.motion?.center_offset_deg ?? null).toBeNull();
  expect(m.notes.join(" ")).toContain(
    "the version 0 policy's angle_cw_stop_deg (0) is not read: 0 deg is the servo's center of travel",
  );
});

function valueOf(q: TuningPolicy): unknown {
  return q.motion?.soft_travel_deg;
}
