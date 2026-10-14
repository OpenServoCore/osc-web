import { Descriptor, initSync, telColumns, type TelChunk } from "@openservocore/client";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import descriptorJson from "../../../open-servo-core/descriptors/osc-servo/0.1.json";
import fixture from "../../tests/fixtures/stall-24mhz.json";
import {
  coverFields,
  decodeBurst,
  DEFAULT_FIELDS,
  isLast,
  PRESETS,
  rateIssue,
  rowBytes,
  summarize,
  summaryText,
  toCsv,
  unitsFor,
  windowValid,
  type FieldKey,
  type Row,
  type StreamConfig,
} from "./stream";
import { calibrationFromTable, senseFromTable } from "./units";

initSync({
  module: readFileSync(
    new URL("../../../open-servo-core/client/web/pkg/osc_client_web_bg.wasm", import.meta.url),
  ),
});

const descriptor = Descriptor.parse(JSON.stringify(descriptorJson));
const layout = new Map(descriptorJson.fields.map((f) => [f.name, f]));

const u16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
const u32 = (v: number) => [...u16(v & 0xffff), ...u16((v >>> 16) & 0xffff)];

/** A stream frame payload: seq, flags, the first row's tick, then the rows. */
function frame(seq: number, last: boolean, tick: number, rows: readonly number[][]): Uint8Array {
  return Uint8Array.from([seq, last ? 1 : 0, ...u16(tick), ...rows.flat()]);
}

function chunksOf(keys: readonly FieldKey[]): TelChunk[] {
  const cover = coverFields(keys, layout);
  if (cover.issue !== undefined) throw new Error(cover.issue);
  return cover.chunks;
}

function decode(keys: readonly FieldKey[], frames: readonly Uint8Array[], windowMin = 60) {
  const chunks = chunksOf(keys);
  return decodeBurst(frames, telColumns(descriptor, chunks), rowBytes(chunks), windowMin);
}

/** Position alone rides in one 16-bit run. */
const posRows = (n: number) => Array.from({ length: n }, (_, i) => u16(0x100 + i));

test("the presets are the protocol's common rows", () => {
  const [six, ident, raw] = PRESETS.map((p) => chunksOf(p.keys));
  // protocol sec 5.6: the six in two runs, identification's four in two with
  // current_trough riding along, the crest scan in one.
  expect(six).toEqual([
    { addr: 0x232, len: 8 },
    { addr: 0x240, len: 4 },
  ]);
  expect(ident).toEqual([
    { addr: 0x238, len: 2 },
    { addr: 0x240, len: 8 },
  ]);
  expect(telColumns(descriptor, chunksOf(PRESETS[1].keys)).map((c) => c.name)).toEqual([
    "pos",
    "duty_ticks",
    "current_trough",
    "i_tick_counts",
    "vdiff_counts",
  ]);
  expect(raw).toEqual([{ addr: 0x232, len: 12 }]);
  expect(DEFAULT_FIELDS).toEqual(PRESETS[0].keys);
});

test("an estimate rides in the second chunk behind the tick block", () => {
  const pos = layout.get("pos");
  const omega = layout.get("omega_hat_cps");
  expect(chunksOf(["omega_hat_cps", "pos"])).toEqual([
    { addr: pos?.addr, len: 2 },
    { addr: omega?.addr, len: 4 },
  ]);
});

test("one block wider than a row splits at its widest gap", () => {
  expect(chunksOf(["current_raw", "vmotor_a", "i_tick_counts", "vdiff_counts"])).toEqual([
    { addr: 0x232, len: 4 },
    { addr: 0x244, len: 4 },
  ]);
});

test("a selection no two runs of 12 B cover is refused in plain words", () => {
  expect(coverFields(["current_raw", "ntc_raw", "sample_tick"], layout)).toEqual({
    issue:
      "these fields need 18 B rows; a row copies at most 12 B in at most 2 runs of the table. Untick some fields or capture them over two bursts.",
  });
  expect(coverFields([], layout)).toEqual({ issue: "pick at least one field" });
  expect(coverFields(["pos"], new Map())).toEqual({ issue: "the servo's table has no pos" });
});

test("a burst arms only at the TEL rate", () => {
  expect(rateIssue("b3000000")).toBeUndefined();
  expect(rateIssue("b1000000")).toBe(
    "TEL streams at 3 Mbaud only: raise the bus speed to 3 M, and use a short cable with good contacts.",
  );
  expect(rateIssue("b2000000")).toMatch(/^TEL streams at 3 Mbaud only/);
});

test("a row decodes at the descriptor's offsets, signed where the table is", () => {
  const head = [...u16(2100), ...u16(800), ...u16(700), ...u16(0x123)];
  const rows = decode(
    ["current_raw", "vmotor_a", "vmotor_b", "pos", "duty_ticks", "current_trough"],
    [
      frame(0x42, false, 0x1234, [
        [...head, ...u16(-300 & 0xffff), ...u16(100)],
        [...head, ...u16(0), ...u16(100)],
      ]),
    ],
  );
  expect(rows).toHaveLength(2);
  // The first frame's first row is sample 0, whatever its seq and stamp.
  expect(rows[0]).toEqual({
    sample: 0,
    valid: true,
    values: {
      current_raw: 2100,
      vmotor_a: 800,
      vmotor_b: 700,
      pos: 0x123,
      duty_ticks: -300,
      current_trough: 100,
    },
  });
  expect(rows[1]).toMatchObject({ sample: 1, valid: false, values: { duty_ticks: 0 } });
});

test("the second chunk's fields follow the first's in the row", () => {
  const rows = decode(
    ["pos", "omega_hat_cps"],
    [frame(0, true, 0, [[...u16(2048), ...u32(-3 * 65536)]])],
  );
  expect(rows[0]?.values).toEqual({ pos: 2048, omega_hat_cps: -3 * 65536 });
  expect(rows[0]?.valid).toBeUndefined();
});

test("window validity is the duty rule, or tick_flags I_VALID when the row carries it", () => {
  expect(windowValid({ duty_ticks: 60 }, 60)).toBe(true);
  expect(windowValid({ duty_ticks: -60 }, 60)).toBe(true);
  expect(windowValid({ duty_ticks: 59 }, 60)).toBe(false);
  expect(windowValid({ duty_ticks: 0 }, 0)).toBe(false);
  expect(windowValid({ duty_ticks: 0, tick_flags: 0b101 }, 60)).toBe(true);
  expect(windowValid({ duty_ticks: 600, tick_flags: 0b100 }, 60)).toBe(false);
  expect(windowValid({ pos: 1 }, 60)).toBeUndefined();
  expect(windowValid({ duty_ticks: 600 }, undefined)).toBeUndefined();
});

test("a lost frame leaves the samples its stamp skips and the LAST flag ends the burst", () => {
  const a = frame(0, false, 100, posRows(16));
  const c = frame(2, true, 132, posRows(3));
  const rows = decode(["pos"], [a, c]);
  expect(rows.map((r) => r.sample)).toEqual([...Array(16).keys(), 32, 33, 34]);
  expect(rows[18]?.values).toEqual({ pos: 0x102 });
  expect(isLast(a)).toBe(false);
  expect(isLast(c)).toBe(true);
});

test("stamps unwrap past 0xffff and ragged payloads are skipped", () => {
  const rows = decode(
    ["pos"],
    [
      frame(255, false, 0xfff8, posRows(16)),
      Uint8Array.from([0, 0, 0, 0, 1]),
      frame(1, false, 0xfff0, [[0x00, 0x01, 0x02]]),
      frame(0, true, 0x0008, posRows(1)),
    ],
  );
  expect(rows.map((r) => r.sample)).toEqual([...Array(17).keys()]);
});

test("the row count comes from the length, and dropped rows jump the stamp without a seq hole", () => {
  const rows = decode(
    ["pos"],
    [
      frame(0, false, 7, posRows(24)),
      frame(1, false, 31, posRows(5)),
      frame(2, true, 40, posRows(2)),
    ],
  );
  expect(rows.map((r) => r.sample)).toEqual([
    ...Array(29).keys(),
    // rows 29..32 dropped by the servo: frame 2 is stamped 4 ticks on
    33,
    34,
  ]);
  expect(rows[23]?.values).toEqual({ pos: 0x100 + 23 });
  expect(rows[24]?.values).toEqual({ pos: 0x100 });
});

test("the summary carries the burst's counters and the decoded sample count", () => {
  const burst = {
    frames: [frame(0, false, 0, posRows(16)), frame(1, true, 16, posRows(4))],
    complete: true,
    statuses: 3,
    garble: 0,
    trailing: false,
  };
  const s = summarize(burst, decode(["pos"], burst.frames));
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
  sense: senseFromTable(
    readFrom({ ...fixture.meta.sense, vmotor_bias_top_ohm: 0, vmotor_bias_bot_ohm: 0 }),
  ),
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
  iWindowMinTicks: 60,
};

test("the CSV names every carried field with its unit, valid empty where the row cannot say", () => {
  const columns = telColumns(descriptor, chunksOf(["current_raw", "vmotor_a", "vmotor_b", "pos"]));
  const rows = decodeBurst(
    [frame(0, true, 0, [[...u16(0x101), ...u16(800), ...u16(700), ...u16(0x800)]])],
    columns,
    8,
    60,
  );
  const lines = toCsv(rows, unitsFor(columns, config, false)).split("\n");
  expect(lines[0]).toBe("sample,valid,current_raw (mA),vmotor_a (V),vmotor_b (V),pos (deg)");
  expect(lines).toHaveLength(3);
  expect(lines[2]).toBe("");
  expect(lines[1]).toMatch(/^0,,-?\d+,-?\d+\.\d\d,-?\d+\.\d\d,\d+\.\d$/);
  // Raw keeps the position family in counts and the electrical fields real.
  const raw = toCsv(rows, unitsFor(columns, config, true)).split("\n");
  expect(raw[0]).toBe("sample,valid,current_raw (mA),vmotor_a (V),vmotor_b (V),pos (counts)");
  expect(raw[1]?.endsWith(",2048")).toBe(true);
  // Without a config every column is counts.
  expect(toCsv(rows, unitsFor(columns, undefined, false)).split("\n")[0]).toBe(
    "sample,valid,current_raw (counts),vmotor_a (counts),vmotor_b (counts),pos (counts)",
  );
});

test("duty is signed PWM compare counts, a percent of pwm_period_ticks", () => {
  const rows = decode(
    ["duty_ticks"],
    [frame(0, true, 0, [u16(-600 & 0xffff), u16(1200), u16(30)])],
  );
  expect(rows.map((r) => r.values.duty_ticks)).toEqual([-600, 1200, 30]);
  const units = unitsFor([{ name: "duty_ticks" }], config, false);
  expect(units[0]).toMatchObject({ key: "duty_ticks", unit: "%" });
  expect(toCsv(rows, units).split("\n").slice(0, 4)).toEqual([
    "sample,valid,duty_ticks (%)",
    "0,1,-50.0",
    "1,1,100.0",
    "2,0,2.5",
  ]);
  expect(unitsFor([{ name: "duty_ticks" }], undefined, false)[0]?.convert(-600)).toBe(-600);
});

test("the estimates scale out of Q16 into degrees, or counts under the raw preference", () => {
  const names = [{ name: "theta_hat_q16" }, { name: "omega_hat_cps" }];
  const [theta, omega] = unitsFor(names, config, false);
  expect(theta).toMatchObject({ unit: "deg" });
  expect(theta?.convert(2000 * 65536)).toBeCloseTo(90);
  expect(omega).toMatchObject({ unit: "deg/s" });
  expect(omega?.convert(-3000 * 65536)).toBeCloseTo(-180);
  const [rawTheta, rawOmega] = unitsFor(names, config, true);
  expect(rawTheta?.convert(2048 * 65536 + 32768)).toBe(2048.5);
  expect(rawOmega).toMatchObject({ unit: "counts/s" });
});

test("one terminal reads through VB as leg current moves it: 100% at 8.4 V reads the rail", () => {
  const vb0 = (4096 * 100) / 530;
  const cfg: StreamConfig = {
    ...config,
    sense: {
      ...config.sense,
      vmotorDivTop: 6400,
      vmotorDivBot: 1600,
      vmotorBiasTopOhm: 430,
      vmotorBiasBotOhm: 100,
    },
    biases: { currentBiasCounts: 0, vmotorBiasCounts: vb0 },
  };
  // the settled node with A at 8.4 V and B low, and the crest taps it gives
  const [lsb, cv] = [3.3 / 4096, (430 * 100) / 530 / 8000];
  const vb = (vb0 + (cv * 8.4) / lsb) / (1 + 2 * cv);
  const [a, b] = [(0.2 * 8.4) / lsb + 0.8 * vb, 0.8 * vb];
  const row = (sample: number, duty?: number): Row => ({
    sample,
    valid: undefined,
    values: { vmotor_a: a, vmotor_b: b, duty_ticks: duty },
  });
  const rows = [...Array.from({ length: 64 }, (_, i) => row(i, 1200)), row(64)];
  const [motorA] = unitsFor([{ name: "vmotor_a" }], cfg, false, rows);
  const at = (i?: number) => motorA?.convert(a, i) ?? NaN;
  expect(at() - 8.4).toBeCloseTo(0.284, 3);
  expect(at(0) - 8.4).toBeCloseTo(0.284 * (1 - 0.06), 2);
  expect(Math.abs(at(63) - 8.4)).toBeLessThan(0.006);
  expect(at(64)).toBe(at());
});
