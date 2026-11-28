import {
  migrate,
  resolvePreview,
  validatePolicy,
  type Preview,
  type ServoProfile,
  type TuningPolicy,
} from "@openservocore/client";
import { formatNumber, parseNumber, slug } from "./profile-form";

export const POLICY_SCHEMA = "osc.tuning-policy/1";
export const DEFAULT_KEY = "default";

/** The record's policy in portable form: every rule-bound value is its rule, no value is one servo's. */
export const DEFAULT_POLICY: TuningPolicy = {
  schema: POLICY_SCHEMA,
  key: DEFAULT_KEY,
  label: "Default",
  protection: {
    run_v: 5.0,
    speed_ceiling: { share_of_no_load: [2, 3] },
    current_limit: { share_of_stall: 0.8 },
    yield: { torque_kg_cm: null },
    plastic_torque_limit_kg_cm: null,
    above_plastic_limit: false,
    stall_release: { share_of_yield: 0.36 },
    stall_response: "yield",
    stall_time_ms: 500,
    stall_speed: { multiple_of_still_speed: 4 },
    cutoff_c: 90,
    position_error: { deg: 9.9, time_ms: 100 },
    duty_max_share: 1.0,
    collision_trip: "off",
  },
  motion: {
    move_speed: { share_of_ceiling: 0.5 },
    speed_up: { s: 0.05 },
  },
  loops: {
    current_loop: { multiple_of_electrical_corner: 1.25 },
    observer: { multiple_of_mechanical_corner: 1.9 },
    velocity_em_ratio: 1.34,
    velocity_zero_ratio: 3.0,
    velocity_shelf_margin_db: 1.0,
    position_split: 7.104,
    hold_band_noise_multiple: 2.5,
    hold_band_floor_counts: 4,
  },
  sensor: { pot_jump: { multiple_of_step4: 4 }, bad_samples: 4 },
  behavior: { openloop_zero_brake: "off", brush_term: "off" },
  why: {
    "protection.run_v":
      "the voltage the servo runs on picks which of the maker's ratings applies: on 5.0 V the stated voltage nearest it, 4.8 V",
    "protection.speed_ceiling":
      "never faster than two thirds of the no-load speed the maker states, written as the ratio 2 over 3: the speed ceiling, which protects the brushes: the owner's decision",
    "protection.current_limit":
      "any other value taken from the maker's sheet is taken at 0.8 of it, to be safe; the current limit is 0.8 of the stated volts over the identified R: the owner's decision",
    "protection.yield":
      "how hard a stalled horn keeps pushing is the application's: with no yield torque a metal train keeps the cap, no fold, and a sustained press ends at the 90 C winding cutoff; a plastic train takes the plastic torque limit: the owner's decision",
    "protection.stall_release":
      "it moves with the yield current, at the record's ratio, 90 over 250, of the yield current as the kernel runs it: the owner's decision",
    "protection.stall_response":
      "a blocked horn folds to the yield current and recovers on the next command, as the Feetech class does, and the 90 C cutoff is the backstop: the owner's decision",
    "protection.stall_time_ms":
      "on a free horn the stall conditions never last past 12 ms, and the Feetech class allows 2 s; interim until the load arm: the owner's decision",
    "protection.stall_speed": "four times the speed noise of a still shaft: the owner's decision",
    "protection.cutoff_c": "one thermal limit, at 90 C: the owner's decision",
    "protection.position_error":
      "twice the worst healthy following error on record, 4.4 deg on a free horn, for longer than a healthy error ever holds; interim until the load arm confirms it: the owner's decision",
    "protection.duty_max_share":
      "no voltage cap: the speed ceiling and the current limit protect the motor: the owner's decision",
    "protection.collision_trip": "the collision trip stays off: the owner's decision",
    "motion.move_speed":
      "half the speed ceiling: the servo has two speeds, the ceiling it never crosses and a move speed set from 0 to it, and this is the move speed's default; interim until the load arm: the owner's decision",
    "motion.speed_up":
      "the move speed reached in 50 ms, from the same sweep; interim with the speed: the owner's decision",
    "motion.soft_travel_deg":
      "none stated: the soft window is the profile's rated travel, centered on 0 deg: the owner's decision",
    "motion.center_offset_deg":
      "none stated: 0 deg is the servo's center of travel, midway between the stops the run measures, and the ends read plus and minus half the travel: the owner's decision",
    "loops.current_loop":
      "the current loop at a multiple of the electrical corner it closes on, R over 2 pi L: on the record 1013.6 Hz against the bench sweep's 1 kHz",
    "loops.observer":
      "the observer at a multiple of the mechanical corner, Ke^2 over 2 pi J R: on the record 15.12 Hz against the bench sweep's 15 Hz",
    "loops.velocity_em_ratio":
      "the lag bound: the electromechanical frequency of the motor's Ke, J and L over the speed loop's crossover: the owner's decision",
    "loops.velocity_zero_ratio":
      "the speed loop's crossover over its PI's zero, a phase margin of 71.6 deg on the rigid plant: the owner's decision",
    "loops.velocity_shelf_margin_db":
      "the shelf of the speed loop held 1 dB under 0 dB on the worst worked sweep of the margin record: the owner's decision",
    "loops.position_split":
      "the speed loop's crossover over the position gain, until the position loop has a sitting of its own: the owner's decision",
    "loops.hold_band_floor_counts":
      "the hold band is 4 counts, a bit of hunting after a landing is fine while it dies down quickly: the owner's decision",
    "sensor.pot_jump":
      "four times the worst healthy value of the statistic the screen tests, the worst run of 4 successive RAIL-period steps over the run's driven rows: the owner's decision",
    "sensor.bad_samples":
      "the default stands: no capture shows a failing pot, and a capture of one would revisit it: the owner's decision",
    "behavior.openloop_zero_brake":
      "zero duty coasts in open loop, which calibration relies on: the owner's decision",
    "behavior.brush_term":
      "the brush term of the back-EMF close is off while the brush learner is pending: the owner's decision",
  },
};

/** The values a form states as a rule over what the run measures; their fixed form ties the policy to one servo. */
export const RULE_FIELDS = [
  "protection.yield",
  "protection.stall_release",
  "protection.stall_speed",
  "loops.current_loop",
  "loops.observer",
  "sensor.pot_jump",
] as const;

/** Each value with a portable and a fixed form. */
export const DUAL_FIELDS = [...RULE_FIELDS, "motion.move_speed", "motion.speed_up"] as const;

export type DualField = (typeof DUAL_FIELDS)[number];

type Sections = Pick<TuningPolicy, "protection" | "motion" | "loops" | "sensor" | "behavior">;
export type Section = keyof Sections;

/** A value's file path, `section.key`. */
export function valueAt(policy: TuningPolicy, path: string): unknown {
  const [section, key] = path.split(".") as [Section, string];
  const s = policy[section] as Readonly<Record<string, unknown>> | undefined;
  return s?.[key];
}

/** The policy with one value replaced; null clears it, so the servo keeps its own. */
export function withValue(policy: TuningPolicy, path: string, value: unknown): TuningPolicy {
  const [section, key] = path.split(".") as [Section, string];
  return { ...policy, [section]: { ...policy[section], [key]: value } };
}

/** The form a two-form value is in: its one key and number, as the file writes it. */
export function formOf(value: unknown): { tag: string; amount: number | null } | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const [entry] = Object.entries(value as Record<string, unknown>);
  if (entry === undefined) return undefined;
  const [tag, amount] = entry;
  return { tag, amount: typeof amount === "number" ? amount : null };
}

const FIXED_TAGS = new Set(["ma", "deg_s", "deg_s2", "hz", "counts"]);

/** The two-form values stated fixed: each ties the policy to one servo. */
export function fixedFields(policy: TuningPolicy): DualField[] {
  return DUAL_FIELDS.filter((f) => {
    const form = formOf(valueAt(policy, f));
    return form !== undefined && FIXED_TAGS.has(form.tag);
  });
}

export function portability(policy: TuningPolicy): string {
  const n = fixedFields(policy).length;
  return n === 0 ? "portable" : `${n} fixed`;
}

export interface PolicyPreview {
  preview?: Preview;
  /** The CLI's refusal of this pair, when it refuses. */
  refusal?: string;
  /** The rule forms the run binds from what it measures. */
  byRun: Set<string>;
}

/** What the run resolves with this profile, each rule form's line saying the run sets it. */
export function previewOf(
  policy: TuningPolicy,
  profile: ServoProfile | undefined,
  rOhm: number | undefined,
): PolicyPreview {
  const byRun = new Set<string>(
    RULE_FIELDS.filter((f) => {
      const form = formOf(valueAt(policy, f));
      return form !== undefined && !FIXED_TAGS.has(form.tag);
    }),
  );
  if (profile === undefined) return { byRun };
  try {
    return { preview: resolvePreview(profile, policy, rOhm ?? 1), byRun };
  } catch (e) {
    return { refusal: e instanceof Error ? e.message : String(e), byRun };
  }
}

/** Move speed in the other form, at the ceiling the preview resolved. */
export function moveSpeedFixed(share: number, ceilingDegS: number): number {
  return share * ceilingDegS;
}

export function moveSpeedShare(degS: number, ceilingDegS: number): number {
  return degS / ceilingDegS;
}

/** Acceleration from the time to the move speed, and back. */
export function accelOf(moveDegS: number, seconds: number): number {
  return moveDegS / seconds;
}

export function speedUpOf(moveDegS: number, accelDegS2: number): number {
  return moveDegS / accelDegS2;
}

/** A share of the no-load speed as written: "2/3" or a decimal over 0 and at most 1. */
export function parseShare(text: string): [number, number] | undefined {
  const t = text.trim();
  const ratio = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (ratio !== null) {
    const n = Number(ratio[1]);
    const d = Number(ratio[2]);
    return n > 0 && d > 0 && n <= d ? [n, d] : undefined;
  }
  const v = Number(t);
  if (t === "" || !Number.isFinite(v) || v <= 0 || v > 1) return undefined;
  const d = 1000;
  return [Math.round(v * d), d];
}

export function shareText([n, d]: readonly [number, number]): string {
  return `${n}/${d}`;
}

/** A user copy's key from its name; Default's own key is taken. */
export function copyKey(name: string): string {
  return slug(name);
}

export const SOFT_TRAVEL = "motion.soft_travel_deg";

export const SOFT_TRAVEL_HINT =
  "Empty is the profile's rated travel. Less narrows the soft window; more widens it, up to the servo's physical travel, which identification reports. The window is centered on 0°.";

export const CENTER_OFFSET = "motion.center_offset_deg";

export const CENTER_OFFSET_HINT =
  "Empty is 0: 0° is the servo's center of travel, which identification measures. A positive offset moves 0° counterclockwise. The soft window moves with it; where it would not fit inside the stops, the run clamps the offset and says so.";

/** The soft margin share a policy stored before the soft travel may still state; the type no longer has it. */
export function retiredSoftMargin(policy: TuningPolicy): string | undefined {
  const share = (policy.motion as Readonly<Record<string, unknown>> | undefined)?.soft_margin_share;
  if (share === undefined) return undefined;
  return validatePolicy({
    ...DEFAULT_POLICY,
    motion: { ...DEFAULT_POLICY.motion, soft_margin_share: share },
  } as TuningPolicy);
}

/** The soft travel typed, blank for the rated travel; any stored soft margin share taken out. */
export function withSoftTravel(
  policy: TuningPolicy,
  text: string | undefined,
): TuningPolicy | { error: string } {
  const n = parseNumber(text ?? "");
  if ("error" in n) return n;
  const own =
    n.value === null ? undefined : validatePolicy(withValue(DEFAULT_POLICY, SOFT_TRAVEL, n.value));
  if (own !== undefined) return { error: own };
  const motion: Record<string, unknown> = { ...policy.motion, soft_travel_deg: n.value };
  delete motion.soft_margin_share;
  return { ...policy, motion };
}

/** The CW stop's angle a policy stored before the center offset may still state; the type no longer has it. */
export function retiredCwStop(policy: TuningPolicy): string | undefined {
  const deg = (policy.motion as Readonly<Record<string, unknown>> | undefined)?.angle_cw_stop_deg;
  if (deg === undefined) return undefined;
  return validatePolicy({
    ...DEFAULT_POLICY,
    motion: { ...DEFAULT_POLICY.motion, angle_cw_stop_deg: deg },
  } as TuningPolicy);
}

/** The center offset typed, blank for the center; any stored CW stop angle taken out. */
export function withCenterOffset(
  policy: TuningPolicy,
  text: string | undefined,
): TuningPolicy | { error: string } {
  const n = parseNumber(text ?? "");
  if ("error" in n) return n;
  const own =
    n.value === null
      ? undefined
      : validatePolicy(withValue(DEFAULT_POLICY, CENTER_OFFSET, n.value));
  if (own !== undefined) return { error: own };
  const motion: Record<string, unknown> = { ...policy.motion, center_offset_deg: n.value };
  delete motion.angle_cw_stop_deg;
  return { ...policy, motion };
}

/** A policy file as version 1: version 0 reads with every value fixed and its key from the file's name. */
export function importPolicy(
  parsed: unknown,
  fileName: string,
): { policy: TuningPolicy; notes: string[] } {
  const holder: ServoProfile = { schema: "osc.servo-profile/1", key: "x" };
  const key = slug(fileName.replace(/\.json$/i, ""));
  const m = migrate(holder, parsed, key === "" ? null : key);
  return { policy: m.policy, notes: m.notes };
}

export function num(v: number): string {
  return formatNumber(v);
}

export const WARN = {
  speedCeiling:
    "Above two thirds of the maker's no-load speed, the brushes of the bench MG90 wore out within seconds. The motor can be ruined.",
  currentLimit:
    "The motor may draw closer to its full stall current. A jammed horn heats the winding faster and can strip the gears.",
  yieldTorque:
    "A blocked horn keeps pushing at this torque until it is released, and whatever it presses on takes it.",
  plasticOver: "Above this, plastic teeth strip when the horn is blocked.",
  stallRelease: "A blocked horn keeps pushing harder after it folds back.",
  stallTime:
    "A blocked horn pushes at full current for longer before it backs off. Gears can strip.",
  stallSpeedLow:
    "A blocked horn whose reading still flickers is not seen as blocked: it keeps pushing at full current.",
  stallSpeedHigh: "A slow move under load can be taken for a block.",
  cutoff:
    "Above 90 °C the winding insulation and the case plastic start to fail. The motor can burn out.",
  positionError:
    "A motor wired backwards or a slipping gear drives longer before torque cuts, and can slam into a stop.",
  runV: "The servo would run above the maker's range: the motor heats more and its brushes wear fast.",
  potJump: "A broken pot wire is noticed later, and the servo can drive blind into a stop.",
  stallYield: "A blocked horn backs off to the yield torque and recovers on the next command.",
  stallFault: "Torque drops and stays off until the fault is cleared.",
  loopRate: "Higher: answers faster, more hum and more hunting at rest.",
  collision: "Not available yet: no rule sets its level",
} as const;
