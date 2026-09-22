import { expect, test } from "vitest";
import {
  applyTheme,
  PANE_KEY,
  readPane,
  readTheme,
  THEME_KEY,
  writePane,
  writeTheme,
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
