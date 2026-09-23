import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { spanHolding, startPoll } from "./table-live";

const spans = [
  { addr: 0, count: 9 },
  { addr: 16, count: 4 },
];

test("spanHolding picks the span the field lies inside", () => {
  expect(spanHolding(spans, { addr: 2, width: 2 })).toBe(spans[0]);
  expect(spanHolding(spans, { addr: 16, width: 4 })).toBe(spans[1]);
});

test("spanHolding falls back to the field's own extent when no span holds all of it", () => {
  expect(spanHolding(spans, { addr: 8, width: 2 })).toEqual({ addr: 8, count: 2 });
  expect(spanHolding([], { addr: 30, width: 1 })).toEqual({ addr: 30, count: 1 });
});

/** A tick whose completion the test controls. */
function gate(): { tick: () => Promise<void>; release: () => void; calls: number } {
  const resolvers: (() => void)[] = [];
  const g = {
    calls: 0,
    tick: () => {
      g.calls++;
      return new Promise<void>((resolve) => resolvers.push(resolve));
    },
    release: () => {
      for (const r of resolvers.splice(0)) r();
    },
  };
  return g;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test("ticks at once, then once per period", async () => {
  const g = gate();
  const stop = startPoll({ periodMs: 100, tick: g.tick, onError: () => undefined });
  expect(g.calls).toBe(1);
  g.release();
  await vi.advanceTimersByTimeAsync(100);
  expect(g.calls).toBe(2);
  g.release();
  await vi.advanceTimersByTimeAsync(100);
  expect(g.calls).toBe(3);
  stop();
});

test("a tick still pending is not overlapped; the next period after it resolves ticks", async () => {
  const g = gate();
  const stop = startPoll({ periodMs: 100, tick: g.tick, onError: () => undefined });
  await vi.advanceTimersByTimeAsync(350);
  expect(g.calls).toBe(1);
  g.release();
  await vi.advanceTimersByTimeAsync(100);
  expect(g.calls).toBe(2);
  stop();
});

test("a hold skips ticks until it lifts", async () => {
  const g = gate();
  let held = true;
  const stop = startPoll({
    periodMs: 100,
    tick: g.tick,
    hold: () => held,
    onError: () => undefined,
  });
  await vi.advanceTimersByTimeAsync(300);
  expect(g.calls).toBe(0);
  held = false;
  await vi.advanceTimersByTimeAsync(100);
  expect(g.calls).toBe(1);
  stop();
});

test("stop ends the ticks and silences a late error", async () => {
  const errors: unknown[] = [];
  let reject: (e: Error) => void = () => undefined;
  const tick = vi.fn(
    () =>
      new Promise<void>((_, rej) => {
        reject = rej;
      }),
  );
  const stop = startPoll({ periodMs: 100, tick, onError: (e) => errors.push(e) });
  stop();
  reject(new Error("late"));
  await vi.advanceTimersByTimeAsync(500);
  expect(tick).toHaveBeenCalledTimes(1);
  expect(errors).toEqual([]);
});

test("an error is reported and polling goes on", async () => {
  const errors: unknown[] = [];
  let fail = true;
  const tick = vi.fn(() => (fail ? Promise.reject(new Error("bus")) : Promise.resolve()));
  const stop = startPoll({ periodMs: 100, tick, onError: (e) => errors.push(e) });
  await vi.advanceTimersByTimeAsync(0);
  expect(errors).toHaveLength(1);
  fail = false;
  await vi.advanceTimersByTimeAsync(200);
  expect(tick).toHaveBeenCalledTimes(3);
  expect(errors).toHaveLength(1);
  stop();
});
