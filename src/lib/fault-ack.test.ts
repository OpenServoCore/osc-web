import type { Field, Value } from "@openservocore/client";
import { expect, test } from "vitest";
import descriptor from "../../../open-servo-core/descriptors/osc-servo/0.1.json";
import { ackFault, enableHolding } from "./fault-ack";

const fields = descriptor.fields as Field[];
const byAddr = new Map(fields.map((f) => [f.addr, f.name]));
const Q16 = 2 ** 16;

/** A servo whose kernel sits at `thetaQ16`; it records each write as name and value. */
function servo(thetaQ16: number) {
  const writes: [string, number | boolean][] = [];
  const codec = {
    fields: () => fields,
    decode: (_name: string, bytes: Uint8Array): Value => ({
      kind: "int",
      value: new DataView(bytes.buffer, bytes.byteOffset).getInt32(0, true),
    }),
    encode: (name: string, value: Value): Uint8Array => {
      if (value.kind === "bytes") throw new Error(name);
      writes.push([name, value.value]);
      return new Uint8Array();
    },
  };
  const client = {
    read: (_id: number, addr: number, count: number): Promise<Uint8Array> => {
      expect(byAddr.get(addr)).toBe("theta_hat_q16");
      const bytes = new Uint8Array(count);
      new DataView(bytes.buffer).setInt32(0, thetaQ16, true);
      return Promise.resolve(bytes);
    },
    write: (_id: number, addr: number): Promise<void> => {
      expect(writes.at(-1)?.[0]).toBe(byAddr.get(addr));
      return Promise.resolve();
    },
  };
  return { client, codec, writes };
}

test("the holding enable writes the kernel's position as the goal, then torque on", async () => {
  const { client, codec, writes } = servo(1234 * Q16 + Q16 / 2 + 1);
  await enableHolding(client, 1, codec);
  expect(writes).toEqual([
    ["goal_position", 1235],
    ["torque_enable", true],
  ]);
});

test("the ack switches torque off before the holding enable", async () => {
  const { client, codec, writes } = servo(-300 * Q16);
  await ackFault(client, 1, codec);
  expect(writes).toEqual([
    ["torque_enable", false],
    ["goal_position", -300],
    ["torque_enable", true],
  ]);
});
