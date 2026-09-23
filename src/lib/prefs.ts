import { isMode, type ModeName } from "./control";

export type Theme = "light" | "dark" | "system";
export type Pane = "open" | "collapsed";
export type Units = "real" | "raw";

export const THEME_KEY = "osc-theme";
export const PANE_KEY = "osc-pane";
export const UNITS_KEY = "osc-units";
export const MODE_KEY = "osc-mode";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ThemeRoot {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

const themes: readonly Theme[] = ["light", "dark", "system"];
const panes: readonly Pane[] = ["open", "collapsed"];
const units: readonly Units[] = ["real", "raw"];

export function isTheme(value: string): value is Theme {
  return themes.some((t) => t === value);
}

export function readTheme(storage: StorageLike): Theme {
  const value = storage.getItem(THEME_KEY);
  return value !== null && isTheme(value) ? value : "system";
}

export function writeTheme(storage: StorageLike, theme: Theme): void {
  storage.setItem(THEME_KEY, theme);
}

export function readPane(storage: StorageLike): Pane {
  const value = storage.getItem(PANE_KEY);
  return panes.find((p) => p === value) ?? "open";
}

export function writePane(storage: StorageLike, pane: Pane): void {
  storage.setItem(PANE_KEY, pane);
}

export function isUnits(value: string): value is Units {
  return units.some((u) => u === value);
}

export function readUnits(storage: StorageLike): Units {
  const value = storage.getItem(UNITS_KEY);
  return value !== null && isUnits(value) ? value : "real";
}

export function writeUnits(storage: StorageLike, value: Units): void {
  storage.setItem(UNITS_KEY, value);
}

/** The control mode the app intends; it is written to the servo, never read from it. */
export function readMode(storage: StorageLike): ModeName {
  const value = storage.getItem(MODE_KEY);
  return value !== null && isMode(value) ? value : "Position";
}

export function writeMode(storage: StorageLike, value: ModeName): void {
  storage.setItem(MODE_KEY, value);
}

export function applyTheme(root: ThemeRoot, theme: Theme): void {
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}
