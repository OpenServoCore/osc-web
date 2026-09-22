import { useSyncExternalStore } from "react";
import {
  readPane,
  readTheme,
  readUnits,
  writePane,
  writeTheme,
  writeUnits,
  type Pane,
  type StorageLike,
  type Theme,
  type Units,
} from "./prefs";

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// The server snapshot is the default: the prerendered shell carries no
// preference, and React re-renders with the stored one after hydration.
function usePref<T>(
  read: (storage: StorageLike) => T,
  write: (storage: StorageLike, value: T) => void,
  fallback: T,
): [T, (value: T) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => read(localStorage),
    () => fallback,
  );
  const set = (next: T) => {
    write(localStorage, next);
    for (const listener of listeners) listener();
  };
  return [value, set];
}

export function useThemePref(): [Theme, (theme: Theme) => void] {
  return usePref(readTheme, writeTheme, "system");
}

export function usePanePref(): [Pane, (pane: Pane) => void] {
  return usePref(readPane, writePane, "open");
}

export function useUnitsPref(): [Units, (units: Units) => void] {
  return usePref(readUnits, writeUnits, "real");
}
