import type { BaudRate, Version } from "@openservocore/client";

export function formatVersion([major, minor, patch]: Version): string {
  return `${major}.${minor}.${patch}`;
}

export function hex16(n: number): string {
  return `0x${n.toString(16).padStart(4, "0")}`;
}

export function formatBaud(rate: BaudRate): string {
  return `${Number(rate.slice(1)) / 1_000_000} M`;
}

export function hexAddr(addr: number): string {
  return `0x${addr.toString(16).padStart(3, "0")}`;
}
