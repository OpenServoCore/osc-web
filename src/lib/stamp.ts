// The plant stamp verdict (protocol sec 5.7) in words: the servo holds a
// stamp over the identified set and the position table, and the host recomputes
// it over what the servo holds now.

import type { Descriptor, OscClient, StampVerdict } from "@openservocore/client";
import { field } from "./bus/spans";
import { STAMP_MISMATCH } from "./data-state";

export function stampWords(v: StampVerdict): string {
  if (v.stored === 0) return "Never stamped: no identification has been committed to this servo.";
  if (v.matches) return "Stamped: the calibration, identified values and position table match it.";
  return "Changed since it was stamped: a covered value or the position table differs from the set osc ident committed.";
}

type Client = Pick<OscClient, "write" | "restamp" | "dataState" | "save">;

/**
 * What `osc stamp --save` does after a hand edit of a covered field: torque
 * off (the servo verifies a stamp only then, and SAVE needs it), the stamp
 * over the set the servo holds, its verdict as the witness, then SAVE.
 */
export async function saveAndStamp(c: Client, id: number, d: Descriptor): Promise<void> {
  const torque = field(d.fields(), "torque_enable");
  await c.write(id, torque.addr, d.encode(torque.name, { kind: "bool", value: false }));
  await c.restamp(id, d);
  const { flags } = await c.dataState(id, d);
  if ((flags & STAMP_MISMATCH) !== 0) {
    throw new Error("The stamp did not verify, so nothing was saved; torque is left off.");
  }
  await c.save(id);
}
