import { expect, test } from "vitest";
import type { RunIdentity } from "./run-folder";
import { hasFinalSet, saveRefusal, saveSaid } from "./save-set";

const UID = "c94b8419d1092aec87de5fd151ce290f";

function run(final: string): RunIdentity {
  return {
    uid: UID,
    utc: "20261127T130203Z",
    tool: null,
    image: null,
    steps: [
      { name: "tune", state: "accepted", why: null },
      { name: "final", state: final, why: null },
    ],
    reach: "",
    profile: null,
    policy: null,
  };
}

test("only a run whose final check accepted a set can be saved, on its own servo", () => {
  expect(hasFinalSet(run("accepted"))).toBe(true);
  expect(hasFinalSet(run("refused"))).toBe(false);
  expect(saveRefusal(run("refused"), { id: 1, uid: UID })).toBe(
    "The run's final check accepted no set: there is nothing to save. Start a new run, or resume this one.",
  );
  expect(saveRefusal(run("accepted"), undefined)).toBe(
    `Servo ${UID} is not on the bus: connect it to save this set.`,
  );
  const other = "0".repeat(32);
  expect(saveRefusal(run("accepted"), { id: 1, uid: other })).toBe(
    `ID 1 is servo ${other}, not this run's servo ${UID}: this set is for that servo only.`,
  );
  expect(saveRefusal(run("accepted"), { id: 1, uid: UID })).toBeUndefined();
});

test("the save's end in a sentence: clean, with differences, or refused in the tool's words", () => {
  const base = { lines: [], files: [] };
  expect(saveSaid({ ...base, saved: true, differences: [] })).toEqual({
    text: "Saved. The servo reads back as the run's final set: 0 differences.",
    bad: false,
  });
  expect(saveSaid({ ...base, saved: true, differences: ["v_kp_q88: servo 70, set 97"] }).text).toBe(
    "Saved, but the servo reads back 1 difference from the run's final set.",
  );
  expect(
    saveSaid({ ...base, saved: false, refused: "torque_enable is on", differences: [] }).text,
  ).toBe("Not saved: torque_enable is on");
});
