import { initSync, migrate, type ServoProfile } from "@openservocore/client";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  blankProfile,
  degPerS,
  fieldIssue,
  formatRatio,
  formatRpm,
  missing,
  motorRpm,
  NO_RATING,
  parseNumber,
  parseStages,
  profileKey,
  pulsesPerTurn,
  REQUIRED,
  secondsPer60,
  slug,
  teethProduct,
  withRatio,
  withRating,
  withStages,
} from "./profile-form";

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

const RECORD = migrate(testdata("profile.json"), undefined).profile;

/** The bench MG90's train, counted: the motor's 9-tooth pinion first. */
const MG90_STAGES: [number, number][] = [
  [9, 48],
  [12, 48],
  [10, 38],
  [10, 38],
];

test("a no-load time per 60 deg reads as horn deg/s and the motor's rpm through the train", () => {
  const at48 = { at_v: 4.8, seconds: 0.1, per_deg: 60 };
  const at60 = { at_v: 6.0, seconds: 0.08, per_deg: 60 };
  expect(degPerS(at48)).toBeCloseTo(600, 9);
  expect(degPerS(at60)).toBeCloseTo(750, 9);
  expect(secondsPer60(at48)).toBeCloseTo(0.1, 12);
  expect(secondsPer60({ at_v: 4.8, seconds: 0.2, per_deg: 120 })).toBeCloseTo(0.1, 12);
  expect(motorRpm(600, 308.0533)).toBeCloseTo(30805.33, 2);
  expect(formatRpm(motorRpm(600, 308.0533))).toBe("30,800");
  expect(formatRpm(motorRpm(750, 308.0533))).toBe("38,500");
});

test("the counted stages multiply to the MG90's 308.05 : 1", () => {
  const ratio = teethProduct(MG90_STAGES);
  expect(ratio).toBeCloseTo(308.0533, 4);
  expect(formatRatio(ratio ?? 0)).toBe("308.05 : 1");
  expect(teethProduct([])).toBeUndefined();
  expect(teethProduct([[0, 48]])).toBeUndefined();
  expect(parseStages("9:48 12:48, 10:38 x 10:38")).toEqual({ stages: MG90_STAGES });
  expect(parseStages("  ")).toEqual({ empty: true });
  expect(parseStages("9:48 12-48")).toEqual({
    error: `"12-48" is not a stage: write the pinion's teeth, a colon, the wheel's`,
  });
  expect("error" in parseStages("0:48")).toBe(true);

  const counted = withStages(blankProfile({ maker: "Vorpal", name: "MG90" }), MG90_STAGES);
  expect(counted.gear_ratio).toBeCloseTo(308.0533, 4);
  expect(counted.gear_stages).toEqual(MG90_STAGES);
  expect(counted.provenance?.fields?.gear_ratio).toEqual({ how: "counted" });
  const typed = withRatio(counted, 308.05);
  expect(typed.gear_stages).toBeUndefined();
  expect(typed.provenance?.fields?.gear_ratio).toEqual({ how: "user" });
});

test("the key is built from the model's names as osc-ident builds one", () => {
  expect(profileKey({ maker: "Vorpal", name: "MG90", variant: "" })).toBe("vorpal-mg90");
  expect(profileKey({ maker: "Vorpal Robotics", name: "MG90 Micro Servo" })).toBe(
    "vorpal-robotics-mg90-micro-servo",
  );
  expect(profileKey({ maker: " Tower Pro ", name: "SG-90", variant: "metal gears" })).toBe(
    "tower-pro-sg-90-metal-gears",
  );
  expect(slug("\u00dcnder__Servo!!")).toBe("nder-servo");
  expect(slug(`${"a".repeat(39)} b`)).toBe("a".repeat(39));
  expect(slug("_ !")).toBe("");
  expect(blankProfile({ maker: "Vorpal", name: "MG90" })).toEqual({
    schema: "osc.servo-profile/1",
    key: "vorpal-mg90",
    model: { maker: "Vorpal", name: "MG90" },
    no_load: [],
    stall: [],
  });
});

test("a blank profile lacks every required fact, each with the CLI's own sentence", () => {
  const blank = blankProfile({ maker: "Vorpal", name: "MG90" });
  expect(missing(blank)).toEqual([...REQUIRED]);
  expect(fieldIssue(blank, "gear_ratio")).toMatch(
    /^Without the gear ratio the run cannot turn motor turns into horn degrees: the profile has no usable gear_ratio/,
  );
  expect(fieldIssue(blank, "gear_class")).toMatch(/^Without the gear material/);
  expect(fieldIssue(blank, "counts")).toMatch(/^Without both counts the run cannot measure/);
  expect(fieldIssue({ ...blank, brushes: 2 }, "counts")).toMatch(/^Without both counts/);
  expect(fieldIssue({ ...blank, travel_deg: 400 }, "travel_deg")).toMatch(
    /^A horn cannot turn more than one turn/,
  );
  expect(fieldIssue(blank, "no_load")).toBe(NO_RATING);
  expect(pulsesPerTurn(blank)).toBeUndefined();
});

test("the record's profile and its version 0 nameplate need nothing more", () => {
  expect(missing(RECORD)).toEqual([]);
  expect(pulsesPerTurn(RECORD)).toBe(6);
  const v0 = migrate(testdata("nameplate.json"), undefined);
  expect(v0.profile.key).toBe("mg90-d");
  expect(missing(v0.profile)).toEqual([]);
  expect(v0.profile.gear_ratio).toBe(RECORD.gear_ratio);
  expect(v0.profile.no_load).toEqual(RECORD.no_load);
});

test("a rating writes a no-load and a stall row at its voltage, replacing the rows there", () => {
  const op: ServoProfile = {
    ...blankProfile({ maker: "Vorpal", name: "MG90" }),
    operating_v: { min: 4.8, max: 6.6 },
  };
  const one = withRating(op, { at_v: 6.0, seconds_per_60: 0.08 });
  expect(one.no_load).toEqual([{ at_v: 6.0, seconds: 0.08, per_deg: 60 }]);
  expect(one.stall).toEqual([{ at_v: 6.0 }]);
  const two = withRating(one, { at_v: 4.8, seconds_per_60: 0.1, torque_kg_cm: 1.8 });
  expect(two.no_load?.map((r) => r.at_v)).toEqual([4.8, 6.0]);
  expect(two.stall).toEqual([{ at_v: 4.8, torque_kg_cm: 1.8 }, { at_v: 6.0 }]);
  const again = withRating(two, { at_v: 6.0, seconds_per_60: 0.09, current_a: 1.1 });
  expect(again.no_load).toHaveLength(2);
  expect(again.stall?.[1]).toEqual({ at_v: 6.0, current_a: 1.1 });
  expect(fieldIssue(again, "no_load")).toBeUndefined();
  expect(fieldIssue(withRating(op, { at_v: 9, seconds_per_60: 0.1 }), "no_load")).toBe(NO_RATING);
});

test("a typed number is a value, blank clears and anything else is refused", () => {
  expect(parseNumber(" 308.05 ")).toEqual({ value: 308.05 });
  expect(parseNumber(".5")).toEqual({ value: 0.5 });
  expect(parseNumber("")).toEqual({ value: null });
  expect(parseNumber("3e2")).toEqual({ value: 300 });
  expect(parseNumber("12a")).toEqual({ error: `"12a" is not a number` });
});
