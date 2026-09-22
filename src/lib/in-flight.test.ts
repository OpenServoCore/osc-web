import { expect, test } from "vitest";
import { inFlight } from "./in-flight";

test("a call while one is pending is skipped, the next one after it runs", async () => {
  let resolve: (v: number) => void = () => undefined;
  let calls = 0;
  const guarded = inFlight(
    () =>
      new Promise<number>((r) => {
        calls++;
        resolve = r;
      }),
  );
  const first = guarded();
  const skipped = guarded();
  expect(calls).toBe(1);
  await expect(skipped).resolves.toBeUndefined();
  resolve(7);
  await expect(first).resolves.toBe(7);
  const third = guarded();
  expect(calls).toBe(2);
  resolve(9);
  await expect(third).resolves.toBe(9);
});

test("a rejection releases the flag", async () => {
  const guarded = inFlight(() => Promise.reject(new Error("boom")));
  await expect(guarded()).rejects.toThrow("boom");
  await expect(guarded()).rejects.toThrow("boom");
});
