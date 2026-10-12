import { initSync } from "@openservocore/client";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import fixture from "../../tests/fixtures/stall-24mhz.json";
import {
  CAP_TEL_ROWS,
  decodeBurst,
  DEFAULT_FIELDS,
  FIELDS,
  fieldsOf,
  isLast,
  maskIssue,
  maskOf,
  rowBytesMax,
  summarize,
  summaryText,
  toCsv,
  unitsFor,
  type StreamConfig,
} from "./stream";
import { calibrationFromTable, senseFromTable } from "./units";

initSync({
  module: readFileSync(
    new URL("../../../open-servo-core/client/web/pkg/osc_client_web_bg.wasm", import.meta.url),
  ),
});

const u16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
/** Two 12-bit fields in three bytes: the 24-bit LE word `a | b << 12`. */
const pair = (a: number, b: number) => {
  const w = (a & 0xfff) | ((b & 0xfff) << 12);
  return [w & 0xff, (w >> 8) & 0xff, w >> 16];
};

/** A frame of `rows`, the valid bit set on even rows. */
function frame(seq: number, last: boolean, rows: readonly number[][]): Uint8Array {
  let valid = 0;
  rows.forEach((_, i) => {
    if (i % 2 === 0) valid |= 1 << i;
  });
  return Uint8Array.from([seq, last ? 1 : 0, ...u16(valid), ...rows.flat()]);
}

/** Position alone rides in one 16-bit slot. */
const posRows = (n: number) => Array.from({ length: n }, (_, i) => u16(0x100 + i));

/** The 1 M, 2 M and 3 M limits the core seeds; 0.5 M carries one byte. */
const PER_RATE = Uint8Array.from([1, 4, 8, 11]);

test("the field table is in mask bit order and the default mask packs to an 8 B row", () => {
  expect(FIELDS.map((f) => f.bit)).toEqual([...FIELDS.keys()]);
  expect(FIELDS.at(-1)?.key).toBe("pos_lin");
  expect(maskOf(DEFAULT_FIELDS)).toBe(0x3c1);
  expect(fieldsOf(0x3c1).map((f) => f.key)).toEqual(DEFAULT_FIELDS);
  expect(maskIssue(0x3c1, "b2000000", 8)).toBeUndefined();
});

test("admission is the servo's row limit at the line's rate, as osc refuses it", () => {
  expect(rowBytesMax(CAP_TEL_ROWS, PER_RATE, "b1000000")).toBe(4);
  expect(rowBytesMax(CAP_TEL_ROWS, PER_RATE, "b3000000")).toBe(11);
  expect(rowBytesMax(0, PER_RATE, "b3000000")).toBeUndefined();
  expect(maskIssue(0x3c1, "b1000000", 4)).toBe(
    "these fields pack to 8 B rows; the servo streams rows of at most 4 B at 1 M. Raise the speed or capture the fields over two bursts.",
  );
  // The six raw fields: 9 B, past 2 M's 8, inside 3 M's 11.
  expect(maskIssue(0x1cd, "b2000000", 8)).toMatch(
    /^these fields pack to 9 B rows; .* 8 B at 2 M\./,
  );
  expect(maskIssue(0x1cd, "b3000000", 11)).toBeUndefined();
  expect(maskIssue(0xfff, "b3000000", 11)).toMatch(/pack to 20 B rows/);
  expect(maskIssue(0x3c1, "b3000000", undefined)).toBe(
    "the servo publishes no TEL row limits: its firmware predates packed TEL rows",
  );
  expect(maskIssue(0, "b3000000", 11)).toBe("pick at least one field");
  expect(maskIssue(1 << 12, "b3000000", 11)).toBe("mask has reserved bits set");
});

test("the protocol's golden row decodes: a lone 12-bit slot, wide signed slots, a signed duty pair", () => {
  const mask = maskOf(["pos", "current", "duty", "vdiff", "ntc_raw"]);
  const golden = [0x23, 0x01, 0xfe, 0xff, 0xd4, 0xfe, 0xfb, 0xcf, 0xab];
  const rows = decodeBurst([frame(0x42, false, [golden, golden])], mask);
  expect(rows).toHaveLength(2);
  // A burst arms at seq 0: a first frame at 0x42 is 0x42 missed frames.
  expect(rows[0]).toEqual({
    sample: 0x42 * 16,
    valid: true,
    values: { pos: 0x123, current: -2, duty: -5, vdiff: -300, ntc_raw: 0xabc },
  });
  expect(rows[1]).toMatchObject({ sample: 0x42 * 16 + 1, valid: false });
});

test("the default fields pair up after the lone position and a seq hole leaves 16 missing samples", () => {
  const mask = maskOf(DEFAULT_FIELDS);
  const row = (i: number) => [...u16(0x800 + i), ...pair(0x100 + i, 0xa00), ...pair(0xb00, 0xfff)];
  const a = frame(
    0,
    false,
    Array.from({ length: 16 }, (_, i) => row(i)),
  );
  const c = frame(2, true, [row(0), row(1), row(2)]);
  const rows = decodeBurst([a, c], mask);
  expect(rows.map((r) => r.sample)).toEqual([...Array(16).keys(), 32, 33, 34]);
  expect(rows[18]?.values).toEqual({
    pos: 0x802,
    current_raw: 0x102,
    vmotor_a: 0xa00,
    vmotor_b: 0xb00,
    vbus_raw: 0xfff,
  });
  expect(isLast(a)).toBe(false);
  expect(isLast(c)).toBe(true);
});

test("seq unwraps past 255 and ragged payloads are skipped", () => {
  const mask = maskOf(["pos"]);
  const rows = decodeBurst(
    [frame(255, false, posRows(16)), Uint8Array.from([0, 0, 0, 0, 1]), frame(0, true, posRows(1))],
    mask,
  );
  expect(rows.map((r) => r.sample)).toEqual(
    [...Array(16).keys()].map((i) => 255 * 16 + i).concat(256 * 16),
  );
});

test("the summary carries the burst's counters and the decoded sample count", () => {
  const mask = maskOf(["pos"]);
  const burst = {
    frames: [frame(0, false, posRows(16)), frame(1, true, posRows(4))],
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

const config: StreamConfig = {
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
  tickHz: 20_000,
  pwmPeriodTicks: 1200,
};

test("the CSV has a header naming the selected fields with their units and one line per row", () => {
  const mask = maskOf(["pos", "current_raw"]);
  const rows = decodeBurst([frame(0, true, [pair(0x800, 0x100), pair(0x801, 0x101)])], mask);
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
  expect(raw.split("\n")[1]?.startsWith("0,1,2048,")).toBe(true);
  // Without a config every column is counts.
  expect(toCsv(rows, unitsFor(mask, undefined, false)).split("\n")[0]).toBe(
    "sample,valid,pos (counts),current_raw (counts)",
  );
});

test("pos_lin is the Q4 word over 16, in degrees through the same angle map as pos", () => {
  const mask = maskOf(["pos", "pos_lin"]);
  const rows = decodeBurst([frame(0, true, [[...u16(0x800), ...u16(0x800 << 4)]])], mask);
  expect(rows[0]?.values).toEqual({ pos: 0x800, pos_lin: 0x800 << 4 });
  const [pos, lin] = unitsFor(mask, config, false);
  expect(lin?.unit).toBe("deg");
  expect(lin?.convert(0x0800 << 4)).toBe(pos?.convert(0x0800));
  const [, rawLin] = unitsFor(mask, config, true);
  expect(rawLin).toMatchObject({ unit: "counts", digits: 1 });
  expect(rawLin?.convert((0x1000 << 4) + 8)).toBe(4096.5);
  expect(unitsFor(mask, undefined, false)[1]?.convert(16)).toBe(1);
  expect(toCsv(rows, unitsFor(mask, config, false)).split("\n")[0]).toBe(
    "sample,valid,pos (deg),pos_lin (deg)",
  );
});

test("duty is signed PWM compare counts, a percent of pwm_period_ticks", () => {
  const mask = maskOf(["duty"]);
  const rows = decodeBurst([frame(0, true, [u16(-600 & 0xfff), u16(1200)])], mask);
  expect(rows.map((r) => r.values.duty)).toEqual([-600, 1200]);
  const units = unitsFor(mask, config, false);
  expect(units[0]).toMatchObject({ key: "duty", unit: "%" });
  expect(toCsv(rows, units).split("\n").slice(0, 3)).toEqual([
    "sample,valid,duty (%)",
    "0,1,-50.0",
    "1,0,100.0",
  ]);
  expect(unitsFor(mask, undefined, false)[0]?.convert(-600)).toBe(-600);
});
