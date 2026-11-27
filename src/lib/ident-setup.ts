import {
  resolvePreview,
  validatePolicy,
  type ServoProfile,
  type TuningPolicy,
} from "@openservocore/client";
import type { ServoSetup } from "./library";
import { WARN } from "./policy-form";
import { fieldIssue, identifiable, NOT_METAL, REQUIRED, slug, type Required } from "./profile-form";

/** Each required fact as a sentence names it: "The profile has no gear ratio". */
export const FIELD_NAME: Record<Required, string> = {
  gear_class: "gear material",
  gear_ratio: "gear ratio",
  travel_deg: "travel stop to stop",
  count_rises_ccw: "count direction",
  counts: "brush and segment counts",
  operating_v: "operating range",
  no_load: "rating inside its operating range",
};

export type Blocker =
  | { kind: "no-profile" }
  | { kind: "not-metal"; text: string }
  /** `text` is the run's refusal of that field. */
  | { kind: "missing"; field: Required; text: string }
  /** The run's refusal of the pair. */
  | { kind: "refused"; text: string };

export interface Readiness {
  /** Identify runs only without one. */
  blocker?: Blocker;
  /** An outcome to know before the run; it never blocks. */
  warning?: string;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Whether a servo can be identified with this pair, in the order the user can act on it. */
export function readiness(profile: ServoProfile | undefined, policy: TuningPolicy): Readiness {
  if (profile === undefined) return { blocker: { kind: "no-profile" } };
  const op = profile.operating_v;
  const runV = policy.protection?.run_v;
  const warning = op != null && runV != null && runV > op.max ? WARN.runV : undefined;
  // Filling the other fields never makes a plastic train identifiable, so it goes first.
  if (profile.gear_class != null && !identifiable(profile)) {
    return { blocker: { kind: "not-metal", text: NOT_METAL }, warning };
  }
  for (const field of REQUIRED) {
    const text = fieldIssue(profile, field);
    if (text !== undefined) return { blocker: { kind: "missing", field, text }, warning };
  }
  const refusal = validatePolicy(policy);
  if (refusal !== undefined) return { blocker: { kind: "refused", text: refusal }, warning };
  try {
    // The resistance moves only the previewed current limit, never whether the pair resolves.
    resolvePreview(profile, policy, 1);
  } catch (e) {
    return { blocker: { kind: "refused", text: message(e) }, warning };
  }
  return { warning };
}

/**
 * The tail of the uid's hex: the form is most significant byte first, and a V006 fills only
 * the low 12 bytes, so the head is the zero pad.
 */
export function uidShort(uid: string): string {
  return uid.slice(-8);
}

/** "Copy for ID n": `<key>-<uid tail>`, the key cut so the tail always fits in 40. */
export function servoCopyKey(policyKey: string, uid: string): string {
  const tail = uidShort(uid);
  const head = slug(policyKey)
    .slice(0, 40 - tail.length - 1)
    .replace(/-+$/, "");
  return head === "" ? tail : `${head}-${tail}`;
}

export function isServoCopy(policyKey: string, uid: string): boolean {
  return policyKey.endsWith(`-${uidShort(uid)}`);
}

/** Which servos chose profile `key`: an ID for each on the bus now, a count for the rest. */
export function usedBy(
  key: string,
  setups: ReadonlyMap<string, ServoSetup>,
  idOf: (uid: string) => number | undefined,
): string | undefined {
  const ids: number[] = [];
  let away = 0;
  for (const [uid, setup] of setups) {
    if (setup.profile?.key !== key) continue;
    const id = idOf(uid);
    if (id === undefined) away += 1;
    else ids.push(id);
  }
  const parts = ids.sort((a, b) => a - b).map((id) => `ID ${id}`);
  if (away > 0) parts.push(`${away} ${away === 1 ? "servo" : "servos"} not on the bus`);
  return parts.length === 0 ? undefined : `used by ${parts.join(", ")}`;
}

/**
 * The least turn the helper reads as a turn, raw counts: far over the pot's noise (under a
 * count with torque off, a worst 4-step run of 15 with the bridge driving), and about 5 deg of
 * horn on the bench MG90's 3619 counts over 184 deg.
 */
export const MIN_TURN_COUNTS = 100;

/** The count direction from the reading before and after a counterclockwise turn by hand. */
export function countDirection(
  before: number,
  after: number,
): { risesCcw: boolean } | { short: number } {
  const moved = after - before;
  if (Math.abs(moved) < MIN_TURN_COUNTS) return { short: Math.abs(moved) };
  return { risesCcw: moved > 0 };
}
