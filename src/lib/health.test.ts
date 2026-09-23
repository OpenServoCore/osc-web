import type { Health } from "@openservocore/client";
import { expect, test } from "vitest";
import { countersLine, statements, trimLine } from "./health";

const clean: Health = {
  faultFlags: 0,
  configDirty: false,
  trimSteps: 0,
  crcFailCount: 0,
  framingDropCount: 0,
};

test("a clean servo states the all-clear alone", () => {
  expect(statements(clean)).toEqual([{ level: "ok", text: "No faults." }]);
});

test("one raised flag states that fault and drops the all-clear", () => {
  const s = statements({ ...clean, faultFlags: 1 << 2 });
  expect(s).toHaveLength(1);
  expect(s[0]?.level).toBe("fault");
  expect(s[0]?.text).toContain("Stalled");
});

test("several raised flags state one sentence each, lowest bit first", () => {
  const s = statements({ ...clean, faultFlags: (1 << 0) | (1 << 1) | (1 << 5) });
  expect(s.map((x) => x.level)).toEqual(["fault", "fault", "fault"]);
  expect(s[0]?.text).toContain("Over current");
  expect(s[1]?.text).toContain("Over temperature");
  expect(s[2]?.text).toContain("Under voltage");
});

test("an undefined flag still states its bit", () => {
  expect(statements({ ...clean, faultFlags: 1 << 7 })[0]?.text).toBe("Unknown fault, bit 7.");
});

test("unsaved changes rank under the faults and above the all-clear", () => {
  expect(statements({ ...clean, configDirty: true })).toEqual([
    { level: "warn", text: "Unsaved changes: settings differ from the saved ones." },
    { level: "ok", text: "No faults." },
  ]);
  expect(statements({ ...clean, faultFlags: 1, configDirty: true }).map((s) => s.level)).toEqual([
    "fault",
    "warn",
  ]);
});

test("the counter lines carry sign and plurals", () => {
  expect(trimLine(clean)).toBe("Clock trim 0 steps");
  expect(trimLine({ ...clean, trimSteps: 3 })).toBe("Clock trim +3 steps");
  expect(trimLine({ ...clean, trimSteps: -1 })).toBe("Clock trim -1 step");
  expect(countersLine(clean)).toBe("0 CRC errors, 0 dropped frames");
  expect(countersLine({ ...clean, crcFailCount: 1, framingDropCount: 1 })).toBe(
    "1 CRC error, 1 dropped frame",
  );
  expect(countersLine({ ...clean, crcFailCount: 2, framingDropCount: 7 })).toBe(
    "2 CRC errors, 7 dropped frames",
  );
});
