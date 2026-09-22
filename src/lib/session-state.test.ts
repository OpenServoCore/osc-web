import { expect, test } from "vitest";
import { idle, reduce, type Servo, type SessionEvent, type SessionState } from "./session-state";

function servo(id: number): Servo {
  return {
    id,
    uid: id.toString(16).padStart(32, "0"),
    ping: { model: 0x0101, fw: 0, alert: false },
  };
}

function run(events: SessionEvent[], from: SessionState = idle): SessionState {
  return events.reduce(reduce, from);
}

const found: SessionEvent = { type: "found", servos: [servo(1), servo(2)], baud: "b1000000" };
const ready = run([{ type: "connect" }, { type: "scan" }, found]);

test("connect walks connecting, scanning, ready", () => {
  const connecting = reduce(idle, { type: "connect" });
  expect(connecting.status).toBe("connecting");
  const scanning = reduce(connecting, { type: "scan" });
  expect(scanning.status).toBe("scanning");
  const done = reduce(scanning, found);
  expect(done.status).toBe("ready");
  expect(done.baud).toBe("b1000000");
  expect(done.servos.map((s) => s.id)).toEqual([1, 2]);
  expect(done.selected).toBeUndefined();
});

test("scan and found only apply in their phase", () => {
  expect(reduce(idle, { type: "scan" })).toBe(idle);
  expect(reduce(idle, found)).toBe(idle);
  const connecting = reduce(idle, { type: "connect" });
  expect(reduce(connecting, found)).toBe(connecting);
  expect(reduce(ready, { type: "connect" })).toBe(ready);
});

test("rescan re-enters scanning from ready", () => {
  const scanning = reduce(ready, { type: "scan" });
  expect(scanning.status).toBe("scanning");
  expect(scanning.servos).toBe(ready.servos);
});

test("selection survives a rescan that still lists the id", () => {
  const selected = reduce(ready, { type: "select", id: 2 });
  expect(selected.selected).toBe(2);
  const again = run(
    [{ type: "scan" }, { type: "found", servos: [servo(2), servo(3)], baud: "b1000000" }],
    selected,
  );
  expect(again.status).toBe("ready");
  expect(again.selected).toBe(2);
});

test("selection clears when a rescan loses the id", () => {
  const selected = reduce(ready, { type: "select", id: 1 });
  const again = run(
    [{ type: "scan" }, { type: "found", servos: [servo(2)], baud: "b1000000" }],
    selected,
  );
  expect(again.selected).toBeUndefined();
});

test("select applies only when ready", () => {
  expect(reduce(idle, { type: "select", id: 1 })).toBe(idle);
  const scanning = reduce(ready, { type: "scan" });
  expect(reduce(scanning, { type: "select", id: 1 })).toBe(scanning);
  expect(reduce(ready, { type: "select", id: undefined }).selected).toBeUndefined();
});

test("failure enters error from connecting, scanning and ready", () => {
  const connecting = reduce(idle, { type: "connect" });
  const scanning = reduce(connecting, { type: "scan" });
  for (const from of [connecting, scanning, reduce(ready, { type: "select", id: 1 })]) {
    const failed = reduce(from, { type: "fail", error: "busy" });
    expect(failed.status).toBe("error");
    expect(failed.error).toBe("busy");
    expect(failed.servos).toEqual([]);
    expect(failed.selected).toBeUndefined();
    expect(failed.baud).toBeUndefined();
  }
});

test("failure after a disconnect is ignored", () => {
  expect(reduce(idle, { type: "fail", error: "late" })).toBe(idle);
});

test("connect leaves error and clears the message", () => {
  const failed = reduce(reduce(idle, { type: "connect" }), { type: "fail", error: "cancelled" });
  const retry = reduce(failed, { type: "connect" });
  expect(retry.status).toBe("connecting");
  expect(retry.error).toBeUndefined();
});

test("disconnect returns to idle from anywhere", () => {
  for (const from of [ready, reduce(ready, { type: "scan" }), reduce(idle, { type: "connect" })]) {
    expect(reduce(from, { type: "disconnect" })).toBe(idle);
  }
});
