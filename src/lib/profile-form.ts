import {
  validateProfile,
  type GearClass,
  type Model,
  type NoLoad,
  type ServoProfile,
  type StallRow,
  type Stopper,
} from "@openservocore/client";

export const PROFILE_SCHEMA = "osc.servo-profile/1";

/** A name as a file key, as osc-ident builds one: lowercase, every other character a dash, at most 40. */
export function slug(name: string): string {
  let s = "";
  for (const c of name) {
    const lower = c >= "A" && c <= "Z" ? c.toLowerCase() : c;
    if ((lower >= "a" && lower <= "z") || (lower >= "0" && lower <= "9")) s += lower;
    else if (!s.endsWith("-")) s += "-";
  }
  return s
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

/** `<maker>-<model>[-<variant>]`. */
export function profileKey(model: Model): string {
  return slug([model.maker, model.name, model.variant].filter((p) => p?.trim()).join("-"));
}

export function blankProfile(model: Model): ServoProfile {
  return { schema: PROFILE_SCHEMA, key: profileKey(model), model, no_load: [], stall: [] };
}

export function modelTitle(profile: ServoProfile): string {
  const m = profile.model;
  const title = [m?.maker, m?.name, m?.variant].filter((p) => p?.trim()).join(" ");
  return title === "" ? profile.key : title;
}

/** Horn speed, deg/s, of a stated no-load row. */
export function degPerS(row: NoLoad): number {
  return row.per_deg / row.seconds;
}

/** The sheet's own unit: seconds per 60 deg. */
export function secondsPer60(row: NoLoad): number {
  return (row.seconds * 60) / row.per_deg;
}

/** The motor's speed behind a horn speed through the train. */
export function motorRpm(hornDegS: number, gearRatio: number): number {
  return (hornDegS / 360) * 60 * gearRatio;
}

/** Each stage's wheel over its pinion, multiplied; undefined when no stage or a count is not over 0. */
export function teethProduct(stages: readonly (readonly [number, number])[]): number | undefined {
  if (stages.length === 0 || stages.some(([p, w]) => !(p > 0 && w > 0))) return undefined;
  return stages.reduce((ratio, [pinion, wheel]) => (ratio * wheel) / pinion, 1);
}

export function stagesText(stages: readonly (readonly [number, number])[]): string {
  return stages.map(([p, w]) => `${p}:${w}`).join(" x ");
}

/** "9:48 12:48 10:38" (commas or x between stages allowed) as `[pinion, wheel]` pairs. */
export function parseStages(
  text: string,
): { stages: [number, number][] } | { error: string } | { empty: true } {
  const parts = text
    .split(/[\s,x]+/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
  if (parts.length === 0) return { empty: true };
  const stages: [number, number][] = [];
  for (const part of parts) {
    const m = /^(\d+):(\d+)$/.exec(part);
    const pinion = Number(m?.[1]);
    const wheel = Number(m?.[2]);
    if (m === null || pinion < 1 || wheel < 1) {
      return { error: `"${part}" is not a stage: write the pinion's teeth, a colon, the wheel's` };
    }
    stages.push([pinion, wheel]);
  }
  return { stages };
}

export function pulsesPerTurn(profile: ServoProfile): number | undefined {
  const { brushes, rotor_segments: segments } = profile;
  return brushes != null && segments != null && brushes > 0 && segments > 0
    ? brushes * segments
    : undefined;
}

/** A number typed into a form; blank is null (the field cleared). */
export function parseNumber(text: string): { value: number | null } | { error: string } {
  const t = text.trim();
  if (t === "") return { value: null };
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return { error: `"${t}" is not a number` };
  return { value: Number(t) };
}

export const GEAR_TEXT: Record<GearClass, string> = {
  metal: "Metal",
  plastic: "Plastic",
  unknown: "Unknown",
};

export const STOPPER_TEXT: Record<Stopper, string> = {
  plastic: "Plastic",
  metal: "Metal",
  none: "None",
};

export function gearOf(value: string): GearClass | null {
  return value === "metal" || value === "plastic" || value === "unknown" ? value : null;
}

export function stopperOf(value: string): Stopper | undefined {
  return value === "plastic" || value === "metal" || value === "none" ? value : undefined;
}

export const NOT_METAL =
  "Identification presses the horn against its stops. Plastic gears can strip, so only metal-gear servos can be identified for now.";

export const PLASTIC_STOPPER =
  "The end stops are plastic: the servo's end-stop guard keeps it from pressing into them; open loop does not.";

export const NO_HEAT_MODEL =
  "Without this motor's heat values the servo estimates the winding temperature from the board's reference motor. A motor that heats faster can pass 90 C before the cutoff acts on a long stall.";

export const NO_RATING =
  "The speed ceiling that protects the brushes cannot be set: no rating states a no-load speed inside the operating range.";

export function identifiable(profile: ServoProfile): boolean {
  return profile.gear_class === "metal";
}

/** The facts the run cannot start without, in the order the CLI checks them. */
export const REQUIRED = [
  "gear_class",
  "gear_ratio",
  "travel_deg",
  "count_rises_ccw",
  "counts",
  "operating_v",
  "no_load",
] as const;

export type Required = (typeof REQUIRED)[number];

// The CLI's check stops at the first fact it lacks. Set beside facts that all pass, a
// field's own value is the only one it can refuse, so each field gets its own message.
const PASSING: ServoProfile = {
  schema: PROFILE_SCHEMA,
  key: "x",
  gear_class: "metal",
  gear_ratio: 1,
  travel_deg: 180,
  count_rises_ccw: true,
  brushes: 2,
  rotor_segments: 3,
  operating_v: { min: 5, max: 5 },
};

function inRange(profile: ServoProfile): NoLoad[] {
  const op = profile.operating_v;
  const rows = profile.no_load ?? [];
  return op == null ? rows : rows.filter((r) => r.at_v >= op.min && r.at_v <= op.max);
}

/** Why the run refuses this field, the CLI's words; undefined when it passes. */
export function fieldIssue(profile: ServoProfile, field: Required): string | undefined {
  if (field === "no_load") return inRange(profile).length === 0 ? NO_RATING : undefined;
  if (field === "counts") {
    const { brushes, rotor_segments } = profile;
    return validateProfile({ ...PASSING, brushes, rotor_segments });
  }
  return validateProfile({ ...PASSING, [field]: profile[field] });
}

/** The heat model's own check: all four over 0, or none. */
export function heatIssue(profile: ServoProfile): string | undefined {
  return profile.thermal == null
    ? undefined
    : validateProfile({ ...PASSING, thermal: profile.thermal });
}

export function missing(profile: ServoProfile): Required[] {
  return REQUIRED.filter((f) => fieldIssue(profile, f) !== undefined);
}

export interface Rating {
  at_v: number;
  seconds_per_60: number;
  torque_kg_cm?: number;
  current_a?: number;
}

/** A no-load and a stall row at one voltage, replacing the rows there; a stall row is written even with neither value. */
export function withRating(profile: ServoProfile, r: Rating): ServoProfile {
  const byVolts = (a: { at_v: number }, b: { at_v: number }) => a.at_v - b.at_v;
  const stall: StallRow = { at_v: r.at_v };
  if (r.torque_kg_cm !== undefined) stall.torque_kg_cm = r.torque_kg_cm;
  if (r.current_a !== undefined) stall.current_a = r.current_a;
  return {
    ...profile,
    no_load: [
      ...(profile.no_load ?? []).filter((x) => x.at_v !== r.at_v),
      { at_v: r.at_v, seconds: r.seconds_per_60, per_deg: 60 },
    ].sort(byVolts),
    stall: [...(profile.stall ?? []).filter((x) => x.at_v !== r.at_v), stall].sort(byVolts),
  };
}

export function withoutRating(profile: ServoProfile, atV: number): ServoProfile {
  return {
    ...profile,
    no_load: (profile.no_load ?? []).filter((x) => x.at_v !== atV),
    stall: (profile.stall ?? []).filter((x) => x.at_v !== atV),
  };
}

/** Every stated voltage, with its rows. */
export function ratings(
  profile: ServoProfile,
): { at_v: number; noLoad?: NoLoad; stall?: StallRow }[] {
  const volts = [
    ...new Set([...(profile.no_load ?? []), ...(profile.stall ?? [])].map((r) => r.at_v)),
  ].sort((a, b) => a - b);
  return volts.map((v) => ({
    at_v: v,
    noLoad: profile.no_load?.find((r) => r.at_v === v),
    stall: profile.stall?.find((r) => r.at_v === v),
  }));
}

/** The value set, its provenance the user's (or `how`), the rest of the file as it was. */
export function withField<K extends keyof ServoProfile>(
  profile: ServoProfile,
  key: K,
  value: ServoProfile[K],
  how = "user",
): ServoProfile {
  const provenance = profile.provenance ?? {};
  return {
    ...profile,
    [key]: value,
    provenance: { ...provenance, fields: { ...provenance.fields, [key]: { how } } },
  };
}

/** The counted stages and the ratio they multiply to. */
export function withStages(profile: ServoProfile, stages: [number, number][]): ServoProfile {
  return {
    ...withField(profile, "gear_ratio", teethProduct(stages) ?? null, "counted"),
    gear_stages: stages,
  };
}

/** A typed ratio: stages that no longer multiply to it go. */
export function withRatio(profile: ServoProfile, ratio: number | null): ServoProfile {
  const next = withField(profile, "gear_ratio", ratio);
  delete next.gear_stages;
  return next;
}

export function formatRatio(ratio: number): string {
  return `${ratio.toFixed(2)} : 1`;
}

export function formatRpm(rpm: number): string {
  return (Math.round(rpm / 100) * 100).toLocaleString("en-US");
}

export function formatNumber(v: number): string {
  return String(Number(v.toPrecision(6)));
}
