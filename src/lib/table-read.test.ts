import type { Field, Value } from "@openservocore/client";
import { expect, test } from "vitest";
import descriptor from "../../../open-servo-core/descriptors/osc-servo/0.1.json";
import { buildTable, type Row } from "./table-model";
import { decodeSpan, MAX_READ, readRows, readSpans } from "./table-read";

const fields = descriptor.fields as Field[];
const model = buildTable({ fields: () => fields });

function tabRows(name: string): Row[] {
  const tab = model.tabs.find((t) => t.name === name);
  if (tab === undefined) throw new Error(`no tab ${name}`);
  return tab.groups.flatMap((g) => g.rows);
}

function row(name: string, addr: number, width: number, kind: Field["kind"] = "uint"): Row {
  const field: Field = { name, addr, width, access: "rw", kind, variants: [] };
  return { field, label: name, kind: { kind: "raw", width }, editable: true, blob: false };
}

test("the real descriptor's tabs read in a handful of spans each", () => {
  expect(readSpans(tabRows("Settings"))).toEqual([
    { addr: 0, count: 9 },
    { addr: 16, count: 4 },
    { addr: 32, count: 59 },
    { addr: 92, count: 25 },
  ]);
  expect(readSpans(tabRows("Calibration"))).toEqual([
    { addr: 128, count: 114 },
    { addr: 282, count: 6 },
  ]);
  expect(readSpans(tabRows("Board"))).toEqual([
    { addr: 242, count: 40 },
    { addr: 288, count: 12 },
  ]);
  expect(readSpans(tabRows("Live values"))).toHaveLength(9);
});

test("contiguous fields merge whatever their order, a gap splits", () => {
  const rows = [row("c", 6, 2), row("a", 0, 4), row("b", 4, 2), row("d", 10, 1)];
  expect(readSpans(rows)).toEqual([
    { addr: 0, count: 8 },
    { addr: 10, count: 1 },
  ]);
});

test("a span stops at the protocol payload cap", () => {
  const rows = [row("a", 0, 200), row("b", 200, 52), row("c", 252, 1)];
  expect(readSpans(rows)).toEqual([
    { addr: 0, count: MAX_READ },
    { addr: 252, count: 1 },
  ]);
  expect(readSpans([row("a", 0, 200), row("b", 200, 53)])).toEqual([
    { addr: 0, count: 200 },
    { addr: 200, count: 53 },
  ]);
});

/** Records the slice each field got; the value is the slice's first byte. */
function recorder(): { decode: (name: string, bytes: Uint8Array) => Value; slices: string[] } {
  const slices: string[] = [];
  return {
    slices,
    decode: (name, bytes) => {
      slices.push(`${name}:${Array.from(bytes).join(",")}`);
      return { kind: "uint", value: bytes[0] ?? -1 };
    },
  };
}

test("decodeSpan slices each field at its offset and skips rows outside the span", () => {
  const rows = [row("a", 10, 1), row("b", 11, 2), row("far", 20, 1)];
  const d = recorder();
  const values = decodeSpan(d, rows, { addr: 10, count: 3 }, new Uint8Array([7, 8, 9]));
  expect(d.slices).toEqual(["a:7", "b:8,9"]);
  expect([...values]).toEqual([
    ["a", 7],
    ["b", 8],
  ]);
});

test("decodeSpan rejects a short read", () => {
  const d = recorder();
  expect(() => decodeSpan(d, [row("a", 4, 2)], { addr: 4, count: 2 }, new Uint8Array(1))).toThrow(
    "read at 0x004 returned 1 of 2 bytes",
  );
});

test("readRows reads the spans in order, one at a time", async () => {
  const rows = [row("a", 0, 1), row("b", 1, 1), row("c", 5, 1)];
  const d = recorder();
  const calls: string[] = [];
  let pending = 0;
  const values = await readRows(rows, d, async (addr, count) => {
    expect(pending).toBe(0);
    pending++;
    calls.push(`${addr}+${count}`);
    await Promise.resolve();
    pending--;
    return Uint8Array.from({ length: count }, (_, i) => addr + i);
  });
  expect(calls).toEqual(["0+2", "5+1"]);
  expect([...values]).toEqual([
    ["a", 0],
    ["b", 1],
    ["c", 5],
  ]);
});
