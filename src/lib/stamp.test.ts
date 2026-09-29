import { expect, test } from "vitest";
import { stampWords } from "./stamp";

test("a zero stamp is never stamped, whatever the recompute says", () => {
  expect(stampWords({ stored: 0, computed: 0x1234, matches: false })).toMatch(/^Never stamped/);
});

test("a matching stamp reads stamped, a differing one reads changed", () => {
  expect(stampWords({ stored: 0x1234, computed: 0x1234, matches: true })).toMatch(/^Stamped/);
  expect(stampWords({ stored: 0x1234, computed: 0x4321, matches: false })).toMatch(
    /^Changed since it was stamped/,
  );
});
