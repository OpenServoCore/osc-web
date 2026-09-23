import { expect, test } from "vitest";
import {
  applyTheme,
  MODE_KEY,
  PANE_KEY,
  readPane,
  readTheme,
  readMode,
  readUnits,
  THEME_KEY,
  UNITS_KEY,
  writeMode,
  writePane,
  writeTheme,
  writeUnits,
  type StorageLike,
} from "./prefs";

function stub(initial: Record<string, string> = {}): StorageLike & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  };
}

test("theme defaults to system and rejects unknown values", () => {
  expect(readTheme(stub())).toBe("system");
  expect(readTheme(stub({ [THEME_KEY]: "dark" }))).toBe("dark");
  expect(readTheme(stub({ [THEME_KEY]: "light" }))).toBe("light");
  expect(readTheme(stub({ [THEME_KEY]: "blue" }))).toBe("system");
});

test("writeTheme round-trips through the storage", () => {
  const s = stub();
  writeTheme(s, "dark");
  expect(s.map.get(THEME_KEY)).toBe("dark");
  expect(readTheme(s)).toBe("dark");
});

test("pane defaults to open and rejects unknown values", () => {
  expect(readPane(stub())).toBe("open");
  expect(readPane(stub({ [PANE_KEY]: "collapsed" }))).toBe("collapsed");
  expect(readPane(stub({ [PANE_KEY]: "closed" }))).toBe("open");
});

test("writePane round-trips through the storage", () => {
  const s = stub();
  writePane(s, "collapsed");
  expect(readPane(s)).toBe("collapsed");
});

test("applyTheme sets data-theme for light and dark and removes it for system", () => {
  const attrs = new Map<string, string>();
  const root = {
    setAttribute: (name: string, value: string) => void attrs.set(name, value),
    removeAttribute: (name: string) => void attrs.delete(name),
  };
  applyTheme(root, "dark");
  expect(attrs.get("data-theme")).toBe("dark");
  applyTheme(root, "light");
  expect(attrs.get("data-theme")).toBe("light");
  applyTheme(root, "system");
  expect(attrs.has("data-theme")).toBe(false);
});

test("units default to real and reject unknown values", () => {
  expect(readUnits(stub())).toBe("real");
  expect(readUnits(stub({ [UNITS_KEY]: "raw" }))).toBe("raw");
  expect(readUnits(stub({ [UNITS_KEY]: "si" }))).toBe("real");
});

test("writeUnits round-trips through the storage", () => {
  const s = stub();
  writeUnits(s, "raw");
  expect(s.map.get(UNITS_KEY)).toBe("raw");
  expect(readUnits(s)).toBe("raw");
});

test("the mode preference defaults to Position and rejects unknown values", () => {
  expect(readMode(stub())).toBe("Position");
  expect(readMode(stub({ [MODE_KEY]: "Velocity" }))).toBe("Velocity");
  expect(readMode(stub({ [MODE_KEY]: "Spin" }))).toBe("Position");
});

test("writeMode round-trips through the storage", () => {
  const s = stub();
  writeMode(s, "OpenLoop");
  expect(s.map.get(MODE_KEY)).toBe("OpenLoop");
  expect(readMode(s)).toBe("OpenLoop");
});
