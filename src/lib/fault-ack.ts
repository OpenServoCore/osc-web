// The latched-fault ack: the torque_enable 0->1 edge is the only one
// (firmware kernel/faults.rs), so these are the enables that clear a fault.

import type { Descriptor, OscClient } from "@openservocore/client";
import { field } from "./bus/spans";

/** theta_hat_q16 is Q16 counts; goal_position is whole counts on the same scale. */
const Q16 = 2 ** 16;

type Client = Pick<OscClient, "read" | "write">;
type Codec = Pick<Descriptor, "fields" | "encode" | "decode">;

/**
 * Torque on with the goal pulled onto the kernel's own position first: a goal
 * left at a stop drives straight back into it and latches the fault again.
 */
export async function enableHolding(c: Client, id: number, d: Codec): Promise<void> {
  const fields = d.fields();
  const theta = field(fields, "theta_hat_q16");
  const at = d.decode(theta.name, await c.read(id, theta.addr, theta.width));
  if (at.kind !== "int") throw new Error(`${theta.name} is ${at.kind}, not int`);
  const goal = field(fields, "goal_position");
  const counts = Math.round(at.value / Q16);
  await c.write(id, goal.addr, d.encode(goal.name, { kind: "int", value: counts }));
  const torque = field(fields, "torque_enable");
  await c.write(id, torque.addr, d.encode(torque.name, { kind: "bool", value: true }));
}

/** The whole ack: torque off, then the holding enable. */
export async function ackFault(c: Client, id: number, d: Codec): Promise<void> {
  const torque = field(d.fields(), "torque_enable");
  await c.write(id, torque.addr, d.encode(torque.name, { kind: "bool", value: false }));
  await enableHolding(c, id, d);
}
