export type Theme = "light" | "dark" | "system";
export type Pane = "open" | "collapsed";

export const THEME_KEY = "osc-theme";
export const PANE_KEY = "osc-pane";

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

export function applyTheme(root: ThemeRoot, theme: Theme): void {
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}
