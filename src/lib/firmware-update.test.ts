import type { BootRow, ImageCheck, Version } from "@openservocore/client";
import { expect, test } from "vitest";
import {
  canEnter,
  COMPAT_UNSET,
  deviceLabel,
  fileRefusal,
  installedVersion,
  leaveWarning,
  locked,
  LOST_WARNING,
  matching,
  preselect,
  overallPercent,
  percent,
  restartResult,
  stepIndex,
  STUCK_WARNING,
  UPDATE_RATE_DEFAULT,
  updatingText,
  verdictText,
  type LoadedFile,
  type Phase,
} from "./firmware-update";

const KEY = 0x1234_abcd;

function file(key: string, check: ImageCheck): LoadedFile {
  return { key, name: `${key}.bin`, bytes: new Uint8Array(), check };
}

function ok(key: string, compat: number): LoadedFile {
  return file(key, { kind: "ok", compat, version: [1, 2, 3], size: 1002 });
}

function row(uid: string, compat: number, app = true): BootRow {
  return {
    uid,
    compat,
    appVersion: app ? [0, 9, 0] : null,
    bootVersion: [0, 6, 2],
    capacity: 58_112,
  };
}

test("the update rate defaults to 0.5 M", () => {
  expect(UPDATE_RATE_DEFAULT).toBe("b500000");
});

test("a row's menu lists only the files carrying its key", () => {
  const files = [ok("a", KEY), ok("b", KEY ^ 1), file("elf", { kind: "elf" })];
  expect(matching(KEY, files).map((f) => f.key)).toEqual(["a"]);
  expect(preselect(KEY, files)).toBe("a");
  expect(matching(0x5555, files)).toEqual([]);
  expect(preselect(0x5555, files)).toBeUndefined();
});

test("a keyless bootloader takes every image and preselects none of several", () => {
  const files = [ok("a", KEY), ok("b", KEY ^ 1), file("short", { kind: "tooShort", len: 3 })];
  expect(matching(COMPAT_UNSET, files).map((f) => f.key)).toEqual(["a", "b"]);
  expect(preselect(COMPAT_UNSET, files)).toBeUndefined();
  expect(preselect(COMPAT_UNSET, [ok("a", KEY)])).toBe("a");
});

test("two files for one board preselect neither", () => {
  expect(preselect(KEY, [ok("a", KEY), ok("b", KEY)])).toBeUndefined();
});

test("Enter needs the bus in hand and one usable image", () => {
  expect(canEnter([ok("a", KEY)], true)).toBe(true);
  expect(canEnter([ok("a", KEY)], false)).toBe(false);
  expect(canEnter([file("elf", { kind: "elf" })], true)).toBe(false);
  expect(canEnter([], true)).toBe(false);
});

test("the dialog locks from Enter until the servos are back", () => {
  const phases: Phase[] = [
    "prepare",
    "entering",
    "devices",
    "flashing",
    "flashed",
    "restarting",
    "done",
  ];
  expect(phases.map((p) => locked(p, false))).toEqual([false, true, true, true, true, true, false]);
  expect(phases.map(stepIndex)).toEqual([0, 1, 2, 3, 4, 4, 5]);
});

test("a refused file reads as a plain sentence", () => {
  expect(fileRefusal({ kind: "elf" })).toBe("This is an ELF file: pick the .bin");
  expect(fileRefusal({ kind: "tooShort", len: 3 })).toBe("This file is not a firmware image");
  expect(fileRefusal({ kind: "misaligned", len: 1000 })).toBe("This file is not a firmware image");
  expect(fileRefusal({ kind: "ok", compat: KEY, version: [1, 2, 3], size: 1002 })).toBeUndefined();
});

test("each install verdict reads as words", () => {
  expect(verdictText({ kind: "installed" })).toBe("Installed");
  expect(verdictText({ kind: "incompatible", image: 1, device: 2 })).toBe(
    "This file is for another board",
  );
  expect(verdictText({ kind: "tooLarge", size: 61_000, capacity: 58_112 })).toBe(
    "Does not fit: 60 KB of 56 KB",
  );
  expect(verdictText({ kind: "status", status: "writeError" })).toBe(
    "The board could not write its flash",
  );
  expect(verdictText({ kind: "crcMismatch", image: 1, device: 2 })).toBe(
    "The written image did not verify",
  );
  expect(verdictText({ kind: "noDevice" })).toBe("The board did not answer");
});

test("a board's percent rounds down and stops at 100", () => {
  expect(percent(0, 44_000)).toBe(0);
  expect(percent(12_800, 44_000)).toBe(29);
  expect(percent(44_000, 44_000)).toBe(100);
  expect(percent(0, 0)).toBe(100);
  expect(updatingText(1, 3)).toBe("Updating 2 of 3");
});

test("the overall percent weighs boards by bytes and counts earlier ones whole", () => {
  const sizes = [1000, 3000];
  expect(overallPercent(sizes, 0, 0)).toBe(0);
  expect(overallPercent(sizes, 0, 1000)).toBe(25);
  // A board that failed partway still counts whole once the next one starts.
  expect(overallPercent(sizes, 1, 0)).toBe(25);
  expect(overallPercent(sizes, 1, 1500)).toBe(62);
  expect(overallPercent(sizes, 2, 0)).toBe(100);
});

test("a row names the roster servo by uid, else a board with no app", () => {
  const roster = [{ id: 4, uid: "00000000AABBCCDDEEFF001122334455" }];
  expect(deviceLabel(row("aabbccddeeff001122334455", KEY), roster)).toBe("ID 4");
  expect(deviceLabel(row("000000000000000000000001", KEY, false), roster)).toBe("No app");
});

test("after the restart the installed servos are marked and the rest wait", () => {
  const rows = [
    row("aaaaaaaaaaaaaaaaaaaaaaa1", KEY),
    row("aaaaaaaaaaaaaaaaaaaaaaa2", KEY),
    row("aaaaaaaaaaaaaaaaaaaaaaa3", KEY, false),
  ];
  const found = [
    {
      id: 1,
      uid: "00000000aaaaaaaaaaaaaaaaaaaaaaa1",
      version: [1, 2, 3] as [number, number, number],
    },
    {
      id: 2,
      uid: "00000000aaaaaaaaaaaaaaaaaaaaaaa2",
      version: [0, 9, 0] as [number, number, number],
    },
  ];
  const result = restartResult(found, rows, new Set(["aaaaaaaaaaaaaaaaaaaaaaa1"]));
  expect(result.back).toEqual([
    { id: 1, version: [1, 2, 3], updated: true },
    { id: 2, version: [0, 9, 0], updated: false },
  ]);
  expect(result.waiting.map((r) => r.uid)).toEqual(["aaaaaaaaaaaaaaaaaaaaaaa3"]);
});

test("a lost adapter unlocks the dialog and always says why", () => {
  expect(locked("flashed", true)).toBe(false);
  expect(leaveWarning("flashed", true, false)).toBe(LOST_WARNING);
  expect(leaveWarning("devices", false, false)).toBeUndefined();
  expect(leaveWarning("devices", false, true)).toBe(STUCK_WARNING);
  expect(leaveWarning("prepare", true, true)).toBeUndefined();
  expect(leaveWarning("done", true, true)).toBeUndefined();
});

test("the installed version is the app's own report unless the bootloader's is newer", () => {
  const apps = [{ uid: "00000000aaaaaaaaaaaaaaaaaaaaaaa1", version: [0, 9, 0] as Version }];
  const servo = row("aaaaaaaaaaaaaaaaaaaaaaa1", KEY);
  expect(installedVersion({ ...servo, appVersion: null }, apps)).toEqual([0, 9, 0]);
  expect(installedVersion({ ...servo, appVersion: [0, 8, 9] }, apps)).toEqual([0, 9, 0]);
  expect(installedVersion({ ...servo, appVersion: [1, 0, 0] }, apps)).toEqual([1, 0, 0]);
  const board = row("aaaaaaaaaaaaaaaaaaaaaaa3", KEY, false);
  expect(installedVersion(board, apps)).toBeNull();
  expect(installedVersion({ ...board, appVersion: [0, 1, 0] }, apps)).toEqual([0, 1, 0]);
});
