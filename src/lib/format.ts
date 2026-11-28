import type { Display } from "./units";
import type { BaudRate, Version } from "@openservocore/client";

export function formatVersion([major, minor, patch]: Version): string {
  return `${major}.${minor}.${patch}`;
}

export function hex16(n: number): string {
  return `0x${n.toString(16).padStart(4, "0")}`;
}

/** In protocol sec 2 rate-index order. */
export const BAUD_RATES: readonly BaudRate[] = ["b500000", "b1000000", "b2000000", "b3000000"];

export function formatBaud(rate: BaudRate): string {
  return `${Number(rate.slice(1)) / 1_000_000} M`;
}

export function hexAddr(addr: number): string {
  return `0x${addr.toString(16).padStart(3, "0")}`;
}

/** Fixed decimals; a value that rounds to zero carries no sign. */
export function fixed(value: number, digits: number): string {
  const text = value.toFixed(digits);
  return text === `-${(0).toFixed(digits)}` ? text.slice(1) : text;
}

/**
 * A unit as the UI shows it, from the ASCII spelling the data and the tool
 * write: deg, C, ohm, the micro u, ^2 and a leading x as their symbols.
 */
export function unitSymbol(unit: string): string {
  return unit
    .replace(/\bdegC\b/g, "°C")
    .replace(/\bdeg\b/g, "°")
    .replace(/(^|[ /(])C(?=$|[ /)])/g, "$1°C")
    .replace(/\b(m|k)?[oO]hm\b/g, "$1Ω")
    .replace(/\bus\b/g, "µs")
    .replace(/\bu([VA])\b/g, "µ$1")
    .replace(/\^2\b/g, "²")
    .replace(/^x(?=$|[ \d])/, "×")
    .replace(/(\d) °(?!C)/g, "$1°");
}

/** What goes between a value and its shown unit: a degree sign or a multiplier closes up. */
export function unitGap(shown: string): string {
  return /^(°(?!C)|×)/.test(shown) ? "" : " ";
}

/** A value and its unit as the UI shows them. */
export function withUnit(value: string, unit: string): string {
  const shown = unitSymbol(unit);
  return shown === "" ? value : `${value}${unitGap(shown)}${shown}`;
}

/** A readout with its unit; a value the sense chain cannot express reads "n/a". */
export function formatQuantity(value: number, display: Display): string {
  if (!Number.isFinite(value)) return "n/a";
  return withUnit(fixed(value, display.digits), display.unit);
}
