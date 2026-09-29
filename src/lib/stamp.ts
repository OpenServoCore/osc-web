// The plant stamp verdict (protocol sec 5.7) in words: the servo holds a
// stamp over the identified set and the pot table, and the host recomputes
// it over what the servo holds now.

import type { StampVerdict } from "@openservocore/client";

export function stampWords(v: StampVerdict): string {
  if (v.stored === 0) return "Never stamped: no identification has been committed to this servo.";
  if (v.matches) return "Stamped: the calibration, identified values and pot table match it.";
  return "Changed since it was stamped: a covered value or the pot table differs from the set osc ident committed.";
}
