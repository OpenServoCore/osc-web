import { expect, test } from "vitest";
import type { Snapshot } from "./manager";
import { BusStore } from "./store";

function frames(): { store: BusStore; tick: () => void } {
  const queue: (() => void)[] = [];
  const store = new BusStore((fn) => queue.push(fn));
  return {
    store,
    tick: () => {
      const pending = queue.splice(0);
      for (const fn of pending) fn();
    },
  };
}

function snapshot(t: number): Snapshot {
  const values = new Map([["pos", { kind: "uint" as const, value: t }]]);
  return { id: 1, seq: t, t, values, read: () => t, stale: false };
}

test("a cell notifies once per frame however many reads land", () => {
  const { store, tick } = frames();
  const cell = store.cell(0);
  let notified = 0;
  cell.subscribe(() => notified++);
  for (const v of [1, 2, 3, 4]) cell.set(v);
  expect(cell.get()).toBe(0);
  expect(notified).toBe(0);
  tick();
  expect(cell.get()).toBe(4);
  expect(notified).toBe(1);
});

test("only changed cells notify", () => {
  const { store, tick } = frames();
  const moved = store.cell("a");
  const still = store.cell("x");
  let movedSeen = 0;
  let stillSeen = 0;
  moved.subscribe(() => movedSeen++);
  still.subscribe(() => stillSeen++);
  moved.set("b");
  still.set("x");
  tick();
  expect(movedSeen).toBe(1);
  expect(stillSeen).toBe(0);
  expect(still.get()).toBe("x");
});

test("one frame is scheduled for the whole store", () => {
  let scheduled = 0;
  const queue: (() => void)[] = [];
  const store = new BusStore((fn) => {
    scheduled++;
    queue.push(fn);
  });
  const a = store.cell(0);
  const b = store.cell(0);
  a.set(1);
  b.set(1);
  a.set(2);
  expect(scheduled).toBe(1);
  for (const fn of queue.splice(0)) fn();
  a.set(3);
  expect(scheduled).toBe(2);
});

test("the ring publishes a fresh array per frame and trims to the window", () => {
  const { store, tick } = frames();
  const ring = store.ring(30);
  let seen = 0;
  ring.subscribe(() => seen++);
  for (const t of [0, 10, 20]) ring.push(snapshot(t));
  tick();
  expect(seen).toBe(1);
  const first = ring.get();
  expect(first.map((s) => s.t)).toEqual([0, 10, 20]);
  ring.push(snapshot(31));
  tick();
  expect(ring.get().map((s) => s.t)).toEqual([10, 20, 31]);
  expect(ring.get()).not.toBe(first);
});
