/** The ids a unicast servo may take (protocol sec 9.2). */
export const ID_MIN = 1;
export const ID_MAX = 249;

export type ManageAction = "assign" | "save" | "reboot" | "factory";

/** Why the bus would refuse `next` as this servo's id; undefined means it takes it. */
export function idIssue(
  next: number,
  current: number,
  fleet: readonly number[],
): string | undefined {
  if (!Number.isInteger(next)) return "Ids are whole numbers.";
  if (next < ID_MIN || next > ID_MAX) return `Ids are ${ID_MIN} to ${ID_MAX}.`;
  if (next === current) return `This servo is already ID ${current}.`;
  if (fleet.includes(next)) return `ID ${next} is taken by another servo.`;
  return undefined;
}

/** Save only touches flash; the other three change who answers, so the roster is re-read. */
export function rescans(action: ManageAction): boolean {
  return action !== "save";
}

/**
 * Only Assign moves the selection, onto the id it handed out. Reboot and
 * Factory leave it where it is: the rescan alone says whether it still answers.
 */
export function selectAfter(action: ManageAction, newId: number): number | undefined {
  return action === "assign" ? newId : undefined;
}
