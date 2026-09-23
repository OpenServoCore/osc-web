import { expect, test } from "vitest";
import fixture from "../../tests/fixtures/stall-24mhz.json";
import {
  decodeBurst,
  DEFAULT_FIELDS,
  FIELDS,
  fieldsOf,
  isLast,
  maskIssue,
  maskOf,
  sampleLen,
  summarize,
  summaryText,
  toCsv,
  unitsFor,
} from "./stream";
import type { TelemetryConfig } from "./telemetry";
import { calibrationFromTable, senseFromTable } from "./units";

/** Mirrors core tel.rs `sample(i)`: every field, window_valid on even i. */
function sampleBytes(mask: number, i: number): number[] {
  const all: [number, number][] = [
    [0, 0x1000 + i],
    [1, (-i - 1) & 0xffff],
    [2, 0xb000 + i],
    [3, 0x2000 + i],
    [4, (-300 - i) & 0xffff],
    [5, 1800 + i],
    [6, 0x0100 + i],
    [7, 0x0a00 + i],
    [8, 0x0b00 + i],
    [9, 0x0c00 + i],
    [10, 0x0d00 + i],
  ];
  const out: number[] = [];
  for (const [bit, v] of all) {
    if ((mask & (1 << bit)) !== 0) out.push(v & 0xff, v >> 8);
  }
  return out;
}

function frame(mask: number, seq: number, last: boolean, count: number): Uint8Array {
  let valid = 0;
  const p = [seq, last ? 1 : 0, 0, 0];
  for (let i = 0; i < count; i++) {
    if (i % 2 === 0) valid |= 1 << i;
    p.push(...sampleBytes(mask, i));
  }
  p[2] = valid & 0xff;
  p[3] = valid >> 8;
  return Uint8Array.from(p);
}

const MASK_SIX = 0x3f;

test("the field table is in mask bit order with two bytes per field", () => {
  expect(FIELDS.map((f) => f.bit)).toEqual([...FIELDS.keys()]);
  expect(maskOf(DEFAULT_FIELDS)).toBe(0x3c1);
  expect(fieldsOf(0x3c1).map((f) => f.key)).toEqual(DEFAULT_FIELDS);
  expect(sampleLen(0x3c1)).toBe(10);
  expect(sampleLen(MASK_SIX)).toBe(12);
});

test("mask rules mirror the firmware's mask_valid", () => {
  expect(maskIssue(0)).toBe("pick at least one field");
  expect(maskIssue(MASK_SIX)).toBeUndefined();
  expect(maskIssue(1 << 11)).toBe("mask has reserved bits set");
  expect(maskIssue(MASK_SIX | (1 << 6))).toBe("at most 6 fields fit one sample");
});

test("the six-field golden frame decodes to the tel.rs sample vector", () => {
  const f = frame(MASK_SIX, 0x42, false, 16);
  // The bytes core's encode_golden_six_field_mask_full_batch pins.
  expect([...f.subarray(0, 4)]).toEqual([0x42, 0x00, 0x55, 0x55]);
  expect([...f.subarray(4, 16)]).toEqual([
    0x00, 0x10, 0xff, 0xff, 0x00, 0xb0, 0x00, 0x20, 0xd4, 0xfe, 0x08, 0x07,
  ]);
  const rows = decodeBurst([f], MASK_SIX);
  expect(rows).toHaveLength(16);
  // A burst arms at seq 0: a first frame at 0x42 is 0x42 missed frames.
  expect(rows[0]?.sample).toBe(0x42 * 16);
  expect(rows[0]).toMatchObject({
    valid: true,
    values: {
      pos: 0x1000,
      current: -1,
      current_trough: 0xb000,
      duty_q15: 0x2000,
      vdiff: -300,
      vbus: 1800,
    },
  });
  expect(rows[15]).toMatchObject({
    sample: 0x42 * 16 + 15,
    valid: false,
    values: { pos: 0x100f, current: -16, vdiff: -315, vbus: 1815 },
  });
  expect(isLast(f)).toBe(false);
});

test("a two-field mask packs in bit order and a seq hole leaves 16 missing samples", () => {
  const mask = maskOf(["pos", "vmotor_a"]);
  const a = frame(mask, 0, false, 16);
  const c = frame(mask, 2, true, 3);
  expect([...a.subarray(4, 8)]).toEqual([0x00, 0x10, 0x00, 0x0a]);
  const rows = decodeBurst([a, c], mask);
  expect(rows).toHaveLength(19);
  expect(rows.map((r) => r.sample)).toEqual([...Array(16).keys(), 32, 33, 34]);
  expect(rows[18]?.values).toEqual({ pos: 0x1002, vmotor_a: 0x0a02 });
  expect(Object.keys(rows[0]?.values ?? {})).toEqual(["pos", "vmotor_a"]);
  expect(isLast(c)).toBe(true);
});

test("seq unwraps past 255 and ragged payloads are skipped", () => {
  const mask = maskOf(["pos"]);
  const rows = decodeBurst(
    [frame(mask, 255, false, 16), Uint8Array.from([0, 0, 0, 0, 1]), frame(mask, 0, true, 1)],
    mask,
  );
  expect(rows.map((r) => r.sample)).toEqual(
    [...Array(16).keys()].map((i) => 255 * 16 + i).concat(256 * 16),
  );
});

test("the summary carries the burst's counters and the decoded sample count", () => {
  const mask = maskOf(["pos"]);
  const burst = {
    frames: [frame(mask, 0, false, 16), frame(mask, 1, true, 4)],
    complete: true,
    statuses: 3,
    garble: 0,
    trailing: false,
  };
  const s = summarize(burst, decodeBurst(burst.frames, mask));
  expect(s).toEqual({
    frames: 2,
    samples: 20,
    complete: true,
    garble: 0,
    trailing: false,
    statuses: 3,
  });
  expect(summaryText(s)).toBe("2 frames, 20 samples, complete, 0 garble, 3 statuses");
  expect(summaryText({ ...s, complete: false, trailing: true })).toBe(
    "2 frames, 20 samples, incomplete, 0 garble, 3 statuses, trailing",
  );
});

function readFrom(table: Record<string, number>) {
  return (name: string) => {
    const v = table[name];
    if (v === undefined) throw new Error(`no ${name}`);
    return v;
  };
}

const config: TelemetryConfig = {
  sense: senseFromTable(readFrom(fixture.meta.sense)),
  cal: calibrationFromTable(
    readFrom({
      raw_min: 500,
      raw_max: 3500,
      angle_min_cdeg: 0,
      angle_max_cdeg: 18000,
      gear_ratio_centi: 100,
    }),
  ),
  biases: { currentBiasCounts: 106, vmotorBiasCounts: 779 },
};

test("the CSV has a header naming the selected fields with their units and one line per row", () => {
  const mask = maskOf(["pos", "current_raw"]);
  const rows = decodeBurst([frame(mask, 0, true, 2)], mask);
  const csv = toCsv(rows, unitsFor(mask, config, false));
  const lines = csv.split("\n");
  expect(lines[0]).toBe("sample,valid,pos (deg),current_raw (mA)");
  expect(lines).toHaveLength(4);
  expect(lines[3]).toBe("");
  expect(lines[1]).toMatch(/^0,1,\d+\.\d,-?\d+$/);
  expect(lines[2]).toMatch(/^1,0,/);
  // Raw keeps the position family in counts and the electrical fields real.
  const raw = toCsv(rows, unitsFor(mask, config, true));
  expect(raw.split("\n")[0]).toBe("sample,valid,pos (counts),current_raw (mA)");
  expect(raw.split("\n")[1]?.startsWith("0,1,4096,")).toBe(true);
  // Without a config every column is counts.
  expect(toCsv(rows, unitsFor(mask, undefined, false)).split("\n")[0]).toBe(
    "sample,valid,pos (counts),current_raw (counts)",
  );
});
