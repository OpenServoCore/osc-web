import type {
  BaudRate,
  BootRow,
  BootStatus,
  Found,
  ImageCheck,
  InstallVerdict,
  Version,
} from "@openservocore/client";

/** Slower is safer on long or unknown wiring; the user may pick a higher rate. */
export const UPDATE_RATE_DEFAULT: BaudRate = "b500000";

/** A bootloader holding this key skips the check and takes every image. */
export const COMPAT_UNSET = 0xffff_ffff;

export interface LoadedFile {
  key: string;
  name: string;
  bytes: Uint8Array;
  check: ImageCheck;
}

export type Phase =
  "prepare" | "entering" | "devices" | "flashing" | "flashed" | "restarting" | "done";

export const STEPS = ["Prepare", "Enter bootloaders", "Devices", "Flash", "Restart"] as const;

/** The stepper position; past the last step once the servos are back. */
export function stepIndex(phase: Phase): number {
  switch (phase) {
    case "prepare":
      return 0;
    case "entering":
      return 1;
    case "devices":
      return 2;
    case "flashing":
      return 3;
    case "flashed":
    case "restarting":
      return 4;
    case "done":
      return 5;
  }
}

export const STUCK_WARNING =
  "1 or more servos are still in bootloader mode. Exiting now will leave them stuck in this mode.";

export const LOST_WARNING =
  "The adapter disconnected. 1 or more servos may still be in bootloader mode: reconnect and restart them from Update firmware.";

function midway(phase: Phase): boolean {
  return phase !== "prepare" && phase !== "done";
}

/**
 * From Enter until the servos are back, leaving would strand them in their
 * bootloaders; with the adapter gone Restart all cannot reach them, so the
 * dialog lets go.
 */
export function locked(phase: Phase, lost: boolean): boolean {
  return midway(phase) && !lost;
}

/** The line beside Restart all: the lost adapter always, the stuck servos once a leave was tried. */
export function leaveWarning(phase: Phase, lost: boolean, warned: boolean): string | undefined {
  if (!midway(phase)) return undefined;
  if (lost) return LOST_WARNING;
  return warned ? STUCK_WARNING : undefined;
}

export function canEnter(files: readonly LoadedFile[], held: boolean): boolean {
  return held && files.some((f) => f.check.kind === "ok");
}

export function fileRefusal(check: ImageCheck): string | undefined {
  switch (check.kind) {
    case "ok":
      return undefined;
    case "elf":
      return "This is an ELF file: pick the .bin";
    case "tooShort":
    case "misaligned":
      return "This file is not a firmware image";
  }
}

/** The loaded images a bootloader with `compat` takes. */
export function matching(compat: number, files: readonly LoadedFile[]): LoadedFile[] {
  return files.filter(
    (f) => f.check.kind === "ok" && (compat === COMPAT_UNSET || f.check.compat === compat),
  );
}

export function preselect(compat: number, files: readonly LoadedFile[]): string | undefined {
  const m = matching(compat, files);
  return m.length === 1 ? m[0]?.key : undefined;
}

function sameChip(found: Found, row: BootRow): boolean {
  return found.uid.toLowerCase().endsWith(row.uid.toLowerCase());
}

export function rosterId(row: BootRow, roster: readonly Found[]): number | undefined {
  return roster.find((f) => sameChip(f, row))?.id;
}

export function deviceLabel(row: BootRow, roster: readonly Found[]): string {
  const id = rosterId(row, roster);
  if (id !== undefined) return `ID ${id}`;
  return row.appVersion === null ? "No app" : "Not on the roster";
}

/** What a servo's app reported about itself before Enter, by its 32-char uid. */
export interface AppReport {
  uid: string;
  version: Version;
}

function newer(a: Version, b: Version): boolean {
  for (let i = 0; i < 3; i++) {
    const [x, y] = [a[i] ?? 0, b[i] ?? 0];
    if (x !== y) return x > y;
  }
  return false;
}

/**
 * The installed app's version. A bootloader reports one only for an image it
 * verified itself, so an app flashed by a debugger reads null there; the
 * app's own report wins unless the bootloader's is newer.
 */
export function installedVersion(row: BootRow, apps: readonly AppReport[]): Version | null {
  const app = apps.find((a) => a.uid.toLowerCase().endsWith(row.uid.toLowerCase()))?.version;
  if (app === undefined) return row.appVersion;
  return row.appVersion !== null && newer(row.appVersion, app) ? row.appVersion : app;
}

export function shortUid(uid: string): string {
  return uid.slice(-8);
}

export function hex32(n: number): string {
  return `0x${n.toString(16).padStart(8, "0")}`;
}

function kbUp(bytes: number): number {
  return Math.ceil(bytes / 1024);
}

function kbDown(bytes: number): number {
  return Math.floor(bytes / 1024);
}

export function percent(done: number, total: number): number {
  return total === 0 ? 100 : Math.min(100, Math.floor((done * 100) / total));
}

/**
 * The flash's share done, by bytes: every board before `index` counts whole,
 * failed or not, so the run ends at 100.
 */
export function overallPercent(sizes: readonly number[], index: number, written: number): number {
  const before = sizes.slice(0, index).reduce((a, b) => a + b, 0);
  return percent(
    before + written,
    sizes.reduce((a, b) => a + b, 0),
  );
}

export function updatingText(index: number, count: number): string {
  return `Updating ${index + 1} of ${count}`;
}

export function bootStatusText(status: BootStatus): string {
  switch (status) {
    case "writeError":
      return "The board could not write its flash";
    case "crcMismatch":
      return "The written image did not verify";
    case "addrOutOfBounds":
      return "The board refused an address outside its app space";
    case "unsupported":
      return "The board does not support this step";
    case "payloadOverflow":
      return "The board refused a write that was too long";
    case "incompatible":
      return "This file is for another board";
    case "request":
    case "ok":
      return "The board gave an unexpected reply";
  }
}

export function verdictText(v: InstallVerdict): string {
  switch (v.kind) {
    case "installed":
      return "Installed";
    case "noDevice":
      return "The board did not answer";
    case "incompatible":
      return "This file is for another board";
    case "tooLarge":
      return `Does not fit: ${kbUp(v.size)} KB of ${kbDown(v.capacity)} KB`;
    case "crcMismatch":
      return "The written image did not verify";
    case "status":
      return bootStatusText(v.status);
  }
}

export interface BackServo {
  id: number;
  version: Version;
  updated: boolean;
}

export interface RestartResult {
  back: BackServo[];
  waiting: BootRow[];
}

/**
 * The servos the walk after the reset found, with the ones this session
 * installed marked, and every listed bootloader that did not come back.
 */
export function restartResult(
  found: readonly (Found & { version: Version })[],
  rows: readonly BootRow[],
  installed: ReadonlySet<string>,
): RestartResult {
  const back = found.map((f) => ({
    id: f.id,
    version: f.version,
    updated: rows.some((r) => installed.has(r.uid) && sameChip(f, r)),
  }));
  const waiting = rows.filter((r) => !found.some((f) => sameChip(f, r)));
  return { back, waiting };
}
