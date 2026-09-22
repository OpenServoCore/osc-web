import { useSyncExternalStore } from "react";

export interface ChartTokens {
  series1: string;
  series2: string;
  series3: string;
  ctx: string;
  grid: string;
  axis: string;
  label: string;
}

const TOKENS: Record<keyof ChartTokens, string> = {
  series1: "--color-series-1",
  series2: "--color-series-2",
  series3: "--color-series-3",
  ctx: "--color-series-ctx",
  grid: "--color-grid",
  axis: "--color-axis",
  label: "--color-text-3",
};

export function readChartTokens(style: { getPropertyValue(name: string): string }): ChartTokens {
  const out = {} as ChartTokens;
  for (const key of Object.keys(TOKENS) as (keyof ChartTokens)[]) {
    out[key] = style.getPropertyValue(TOKENS[key]).trim();
  }
  return out;
}

const empty = readChartTokens({ getPropertyValue: () => "" });
const DARK = "(prefers-color-scheme: dark)";
const listeners = new Set<() => void>();
let cached = empty;
let stale = true;
let observer: MutationObserver | undefined;

function invalidate(): void {
  stale = true;
  for (const listener of listeners) listener();
}

// The theme lands as a data-theme attribute (or the OS setting), so both are
// watched; the tokens are re-read from computed style only after a change.
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    observer = new MutationObserver(invalidate);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    matchMedia(DARK).addEventListener("change", invalidate);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      observer?.disconnect();
      observer = undefined;
      matchMedia(DARK).removeEventListener("change", invalidate);
    }
  };
}

function snapshot(): ChartTokens {
  if (stale) {
    stale = false;
    const next = readChartTokens(getComputedStyle(document.documentElement));
    if (
      Object.keys(TOKENS).some(
        (k) => next[k as keyof ChartTokens] !== cached[k as keyof ChartTokens],
      )
    ) {
      cached = next;
    }
  }
  return cached;
}

export function useChartTokens(): ChartTokens {
  return useSyncExternalStore(subscribe, snapshot, () => empty);
}
