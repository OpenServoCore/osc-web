import type { DataState, Descriptor, Field } from "@openservocore/client";
import { expect, test } from "vitest";
import descriptor from "../../../open-servo-core/descriptors/osc-servo/0.1.json";
import { STAMP_MISMATCH } from "./data-state";
import { saveAndStamp, stampWords } from "./stamp";

const fields = descriptor.fields as Field[];
const codec = {
  fields: () => fields,
  encode: (_name: string, v: { value: unknown }) => new Uint8Array([v.value === true ? 1 : 0]),
} as unknown as Descriptor;

/** A servo that answers the stamp's verdict with `flags`; it logs each step. */
function servo(flags: number) {
  const steps: string[] = [];
  const name = (addr: number) => fields.find((f) => f.addr === addr)?.name;
  const client = {
    write: (_id: number, addr: number, data: Uint8Array) => {
      steps.push(`${name(addr)}=${data[0]}`);
      return Promise.resolve();
    },
    restamp: () => {
      steps.push("restamp");
      return Promise.resolve(0x1234);
    },
    dataState: () => {
      steps.push("dataState");
      return Promise.resolve({ flags } as DataState);
    },
    save: () => {
      steps.push("save");
      return Promise.resolve();
    },
  };
  return { client, steps };
}

test("a zero stamp is never stamped, whatever the recompute says", () => {
  expect(stampWords({ stored: 0, computed: 0x1234, matches: false })).toMatch(/^Never stamped/);
});

test("a matching stamp reads stamped, a differing one reads changed", () => {
  expect(stampWords({ stored: 0x1234, computed: 0x1234, matches: true })).toMatch(/^Stamped/);
  expect(stampWords({ stored: 0x1234, computed: 0x4321, matches: false })).toMatch(
    /^Changed since it was stamped/,
  );
});

test("save and stamp runs the CLI's order: torque off, stamp, its verdict, then save", async () => {
  const { client, steps } = servo(0);
  await saveAndStamp(client, 1, codec);
  expect(steps).toEqual(["torque_enable=0", "restamp", "dataState", "save"]);
});

test("a stamp the servo does not verify is never saved", async () => {
  const { client, steps } = servo(STAMP_MISMATCH);
  await expect(saveAndStamp(client, 1, codec)).rejects.toThrow(/did not verify/);
  expect(steps).toEqual(["torque_enable=0", "restamp", "dataState"]);
});
