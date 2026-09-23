import { describe, expect, test } from "vitest";
import { expandFor, initialOpen, searchTarget, withOpen } from "./table-search";

const groups = [
  { label: "Identity and bus", expanded: false },
  { label: "Motion limits", expanded: true },
  { label: "Thermal", expanded: false },
];

test("searchTarget names the tab, the group and the row", () => {
  expect(
    searchTarget({
      label: "Response deadline",
      name: "response_deadline_us",
      tab: "Settings",
      group: "Identity and bus",
      addr: 0x012,
    }),
  ).toEqual({ tab: "Settings", group: "Identity and bus", row: "response_deadline_us" });
});

test("initialOpen takes the model's defaults", () => {
  expect([...initialOpen(groups)]).toEqual([
    ["Identity and bus", false],
    ["Motion limits", true],
    ["Thermal", false],
  ]);
});

test("withOpen sets one group and leaves the rest", () => {
  const open = withOpen(initialOpen(groups), "Motion limits", false);
  expect(open.get("Motion limits")).toBe(false);
  expect(open.get("Identity and bus")).toBe(false);
  expect(open.get("Thermal")).toBe(false);
});

describe("expandFor", () => {
  test("expands a collapsed group and leaves the rest", () => {
    const open = expandFor(initialOpen(groups), "Thermal");
    expect(open.get("Thermal")).toBe(true);
    expect(open.get("Identity and bus")).toBe(false);
    expect(open.get("Motion limits")).toBe(true);
  });

  test("keeps the map itself when the group is already expanded", () => {
    const open = initialOpen(groups);
    expect(expandFor(open, "Motion limits")).toBe(open);
  });

  test("expands a group the map does not carry", () => {
    expect(expandFor(new Map(), "Calibration").get("Calibration")).toBe(true);
  });
});
