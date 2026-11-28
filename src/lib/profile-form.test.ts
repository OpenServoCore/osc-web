import {
  initSync,
  migrate,
  noHeatModel,
  type HeatModel,
  type ServoProfile,
} from "@openservocore/client";
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
  NO_HEAT_MODEL,
  NO_RATING,
  parseNumber,
  parseStages,
  profileKey,
  pulsesPerTurn,
  REQUIRED,
  secondsPer60,
  slug,
  teethProduct,
  withRatedTravel,
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
  expect(fieldIssue({ ...blank, rated_travel_deg: 400 }, "rated_travel_deg")).toMatch(
    /^The run sets the soft limits to the rated travel and paces its first moves by it: the profile has no usable rated_travel_deg/,
  );
  expect(fieldIssue(blank, "no_load")).toBe(NO_RATING);
  expect(fieldIssue(blank, "thermal")).toBe(NO_HEAT_MODEL);
  expect(pulsesPerTurn(blank)).toBeUndefined();
});

test("a blank heat model is refused in the run's words, and each value out of range in the check's", () => {
  expect(NO_HEAT_MODEL).toBe(noHeatModel());
  expect(missing({ ...RECORD, thermal: null })).toEqual(["thermal"]);
  const heat = RECORD.thermal;
  if (heat == null) throw new Error("the record's profile states a heat model");
  const at = (change: Partial<HeatModel>) =>
    fieldIssue({ ...RECORD, thermal: { ...heat, ...change } }, "thermal");
  expect(at({})).toBeUndefined();
  expect(at({ fast_gain_c_per_w: 0 })).toMatch(
    /^The winding temperature estimate needs each node's gain over 0/,
  );
  expect(at({ slow_tau_s: 0.3 })).toMatch(
    /^A time constant is stored in whole seconds.*thermal\.slow_tau_s is 0\.3 s; state it at least 0\.5 s and at most 65535 s$/,
  );
  expect(at({ fast_tau_s: 70000 })).toMatch(/thermal\.fast_tau_s is 70000 s/);
});

test("the record's profile and its version 0 nameplate need nothing more", () => {
  expect(missing(RECORD)).toEqual([]);
  expect(pulsesPerTurn(RECORD)).toBe(6);
  const alone = migrate(testdata("nameplate.json"), undefined);
  expect(missing(alone.profile)).toEqual(["thermal"]);
  const v0 = migrate(
    testdata("nameplate.json"),
    undefined,
    undefined,
    testdata("thermal.json"),
    "thermal.json",
    "0".repeat(40),
  );
  expect(v0.profile.key).toBe("mg90-d");
  expect(missing(v0.profile)).toEqual([]);
  expect(v0.profile.thermal).toEqual(RECORD.thermal);
  expect(v0.profile.provenance?.fields?.thermal).toEqual({
    how: "file",
    file: "thermal.json",
    sha1: "0".repeat(40),
  });
  expect(v0.profile.gear_ratio).toBe(RECORD.gear_ratio);
  expect(v0.profile.no_load).toEqual(RECORD.no_load);
});

test("a profile stored with the stop-to-stop travel_deg asks for the rated travel in the run's words", () => {
  const stored = {
    ...RECORD,
    rated_travel_deg: null,
    travel_deg: 184.33,
    provenance: {
      ...RECORD.provenance,
      fields: { ...RECORD.provenance?.fields, travel_deg: { how: "user" } },
    },
  } as ServoProfile;
  const retired =
    "the profile states travel_deg, the stop-to-stop travel, which this tool now measures: take it out and enter rated_travel_deg, the travel the maker's sheet states (180 for a servo sold as 180 deg)";
  expect(fieldIssue(stored, "rated_travel_deg")).toBe(retired);
  expect(missing(stored)).toEqual(["rated_travel_deg"]);
  const entered = withRatedTravel(stored, 180);
  expect(entered.rated_travel_deg).toBe(180);
  expect("travel_deg" in entered).toBe(false);
  expect(entered.provenance?.fields?.travel_deg).toBeUndefined();
  expect(entered.provenance?.fields?.rated_travel_deg).toEqual({ how: "user" });
  expect(missing(entered)).toEqual([]);
});

test("a version 0 nameplate's travel_deg is noted on import and never carried as the rating", () => {
  const m = migrate(testdata("nameplate-stop-to-stop.json"), undefined);
  expect(m.profile.rated_travel_deg ?? null).toBeNull();
  expect(m.notes).toContain(
    "the version 0 nameplate's travel_deg (184.33) is the travel stop to stop; the profile takes the maker's rated travel: enter rated_travel_deg",
  );
  expect(fieldIssue(m.profile, "rated_travel_deg")).toMatch(/no usable rated_travel_deg/);
  expect(RECORD.rated_travel_deg).toBe(180);
  expect(RECORD.provenance?.fields?.rated_travel_deg?.how).toBe("user");
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
