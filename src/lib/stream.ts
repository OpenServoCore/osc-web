// The Stream tab minus React: the fields a TEL row can copy and the chunks
// that cover them (protocol sec 5.6), the 3 M rule, the decoder (a row is
// table bytes, read at the descriptor's offsets) and the CSV export.

import {
  telBaud,
  telChunksMax,
  telChunksValid,
  telRowBytesMax,
  telStreamFrame,
  type BaudRate,
  type TelChunk,
  type TelColumn,
} from "@openservocore/client";
import { fixed, formatBaud } from "./format";
import type { TelemetryConfig } from "./telemetry";
import { windingC } from "./thermal";
import {
  busV,
  currentMa,
  DISPLAY,
  dutyTicksPercent,
  motorV,
  positionDeg,
  temperatureC,
  vdiffV,
  velocityDegPerS,
  type Display,
} from "./units";

const FLAG_LAST = 1;
/** `tick_flags` bit 0: the shunt read this tick's window. */
const TICK_FLAG_I_VALID = 1;
/** theta_hat_q16 and omega_hat_cps carry 16 fraction bits. */
const Q16 = 2 ** 16;

export type Family = "position" | "electrical";

/**
 * In table order: the tick block, then the medium-rate estimates. `key` is
 * the descriptor's name, so a CSV column names it.
 */
export const FIELDS = [
  { key: "current_raw", label: "Current raw", family: "electrical", estimate: false },
  { key: "vmotor_a", label: "Motor A", family: "electrical", estimate: false },
  { key: "vmotor_b", label: "Motor B", family: "electrical", estimate: false },
  { key: "pos", label: "Position", family: "position", estimate: false },
  { key: "vcal", label: "Vcal", family: "electrical", estimate: false },
  { key: "vbus_raw", label: "Bus raw", family: "electrical", estimate: false },
  { key: "ntc_raw", label: "NTC raw", family: "electrical", estimate: false },
  // Signed PWM compare counts; full scale is pwm_period_ticks.
  { key: "duty_ticks", label: "Duty", family: "electrical", estimate: false },
  { key: "current_trough", label: "Current trough", family: "electrical", estimate: false },
  { key: "i_tick_counts", label: "Current", family: "electrical", estimate: false },
  { key: "vdiff_counts", label: "Motor V", family: "electrical", estimate: false },
  { key: "vmotor_a_trough", label: "Motor A trough", family: "electrical", estimate: false },
  { key: "vmotor_b_trough", label: "Motor B trough", family: "electrical", estimate: false },
  { key: "tick_flags", label: "Tick flags", family: "electrical", estimate: false },
  { key: "sample_tick", label: "Sample tick", family: "electrical", estimate: false },
  { key: "theta_hat_q16", label: "Position estimate", family: "position", estimate: true },
  { key: "omega_hat_cps", label: "Velocity estimate", family: "position", estimate: true },
  { key: "tau_d_counts", label: "Disturbance", family: "electrical", estimate: true },
  { key: "i_lim_counts", label: "Current ceiling", family: "electrical", estimate: true },
  { key: "t_winding_cc", label: "Winding temp", family: "electrical", estimate: true },
  { key: "vbus_counts", label: "Bus V", family: "electrical", estimate: true },
] as const satisfies readonly {
  key: string;
  label: string;
  family: Family;
  estimate: boolean;
}[];

export type FieldDef = (typeof FIELDS)[number];
export type FieldKey = FieldDef["key"];

export const PRESETS = [
  {
    label: "Default six",
    keys: ["current_raw", "vmotor_a", "vmotor_b", "pos", "duty_ticks", "current_trough"],
  },
  { label: "Ident four", keys: ["pos", "duty_ticks", "i_tick_counts", "vdiff_counts"] },
  {
    label: "Raw frame",
    keys: ["current_raw", "vmotor_a", "vmotor_b", "pos", "vcal", "vbus_raw"],
  },
] as const satisfies readonly { label: string; keys: readonly FieldKey[] }[];

export const DEFAULT_FIELDS: readonly FieldKey[] = PRESETS[0].keys;

/** Where a field sits in the table, from the descriptor. */
export interface Placement {
  addr: number;
  width: number;
}

export type Cover = { chunks: TelChunk[]; issue?: undefined } | { issue: string };

function run(fields: readonly Placement[]): TelChunk {
  const addr = fields[0]?.addr ?? 0;
  const end = Math.max(...fields.map((f) => f.addr + f.width));
  return { addr, len: end - addr };
}

/**
 * The chunks a row copies to carry `keys`: one run of the table per group,
 * the estimates in a chunk of their own (the servo copies every chunk when it
 * publishes the tick block, so estimates arrive as last published, up to one
 * tick old), and a lone group split at its widest gap when one run outgrows
 * the row. Fields inside a run's gaps ride along.
 */
export function coverFields(
  keys: Iterable<FieldKey>,
  layout: ReadonlyMap<string, Placement>,
): Cover {
  const wanted = new Set(keys);
  const placed: (Placement & { estimate: boolean })[] = [];
  for (const f of FIELDS) {
    if (!wanted.has(f.key)) continue;
    const at = layout.get(f.key);
    if (at === undefined) return { issue: `the servo's table has no ${f.key}` };
    placed.push({ addr: at.addr, width: at.width, estimate: f.estimate });
  }
  if (placed.length === 0) return { issue: "pick at least one field" };
  placed.sort((a, b) => a.addr - b.addr);
  const max = telRowBytesMax();
  let groups = [placed.filter((f) => !f.estimate), placed.filter((f) => f.estimate)].filter(
    (g) => g.length > 0,
  );
  if (groups.length === 1 && run(placed).len > max && telChunksMax() > 1) {
    const gap = (i: number) => {
      const left = placed[i - 1];
      return (placed[i]?.addr ?? 0) - (left === undefined ? 0 : left.addr + left.width);
    };
    let cut = 1;
    for (let i = 2; i < placed.length; i++) if (gap(i) > gap(cut)) cut = i;
    groups = [placed.slice(0, cut), placed.slice(cut)];
  }
  const chunks = groups.map(run);
  const total = rowBytes(chunks);
  if (total > max || !telChunksValid(chunks)) {
    return {
      issue: `these fields need ${total} B rows; a row copies at most ${max} B in at most ${telChunksMax()} runs of the table. Untick some fields or capture them over two bursts.`,
    };
  }
  return { chunks };
}

export function rowBytes(chunks: readonly TelChunk[]): number {
  return chunks.reduce((sum, c) => sum + c.len, 0);
}

/** Why a burst at `baud` would not stream, or undefined: below the TEL rate the servo acks the arm and stays silent. */
export function rateIssue(baud: BaudRate): string | undefined {
  if (baud === telBaud()) return undefined;
  const tel = formatBaud(telBaud());
  return `TEL streams at ${tel}baud only: raise the bus speed to ${tel}, and use a short cable with good contacts.`;
}

export interface Row {
  /** Fast-tick index from the burst's first row; a lost frame or a dropped row leaves missing indices. */
  sample: number;
  /** This tick's current window was read; undefined when the row carries neither tick_flags nor duty_ticks. */
  valid: boolean | undefined;
  values: Partial<Record<string, number>>;
}

/**
 * The kernel's window rule: `tick_flags` I_VALID when the row carries it,
 * else a nonzero duty at least `i_window_min_ticks` wide.
 */
export function windowValid(
  values: Partial<Record<string, number>>,
  iWindowMinTicks: number | undefined,
): boolean | undefined {
  const flags = values.tick_flags;
  if (flags !== undefined) return (flags & TICK_FLAG_I_VALID) !== 0;
  const duty = values.duty_ticks;
  if (duty === undefined || iWindowMinTicks === undefined) return undefined;
  return duty !== 0 && Math.abs(duty) >= iWindowMinTicks;
}

function readLe(view: DataView, at: number, column: TelColumn): number | undefined {
  switch (column.width) {
    case 1:
      return column.signed ? view.getInt8(at) : view.getUint8(at);
    case 2:
      return column.signed ? view.getInt16(at, true) : view.getUint16(at, true);
    case 4:
      return column.signed ? view.getInt32(at, true) : view.getUint32(at, true);
    default:
      return undefined;
  }
}

/**
 * Splits the CRC-clean stream payloads of one burst into rows of `rowBytes`.
 * A frame's head stamps its first row with the servo's tick (u16) and its
 * length gives the row count, so each frame's rows tick on from its stamp,
 * unwrapped against the previous frame's: a lost frame or rows the servo
 * dropped leave missing samples. The first frame's first row is sample 0.
 * A payload that cannot be a frame of these rows is skipped.
 */
export function decodeBurst(
  frames: readonly Uint8Array[],
  columns: readonly TelColumn[],
  rowBytes: number,
  iWindowMinTicks: number | undefined,
): Row[] {
  const rows: Row[] = [];
  let stamp: number | undefined;
  let base = 0;
  for (const payload of frames) {
    const frame = telStreamFrame(rowBytes, payload);
    if (frame === undefined) continue;
    if (stamp !== undefined) base += (frame.tick - stamp) & 0xffff;
    stamp = frame.tick;
    const view = new DataView(frame.rows.buffer, frame.rows.byteOffset, frame.rows.byteLength);
    for (let at = 0, i = 0; at + rowBytes <= frame.rows.length; at += rowBytes, i++) {
      const values: Partial<Record<string, number>> = {};
      for (const c of columns) values[c.name] = readLe(view, at + c.offset, c);
      rows.push({ sample: base + i, valid: windowValid(values, iWindowMinTicks), values });
    }
  }
  return rows;
}

/** The last frame of a burst carries the LAST flag; the line frees after it. */
export function isLast(payload: Uint8Array): boolean {
  return ((payload[1] ?? 0) & FLAG_LAST) !== 0;
}

/** What `telBurst` reports besides the payloads. */
export interface BurstInfo {
  frames: readonly Uint8Array[];
  complete: boolean;
  statuses: number;
  garble: number;
  trailing: boolean;
}

export interface Summary {
  frames: number;
  samples: number;
  complete: boolean;
  garble: number;
  trailing: boolean;
  statuses: number;
}

export function summarize(burst: BurstInfo, rows: readonly Row[]): Summary {
  return {
    frames: burst.frames.length,
    samples: rows.length,
    complete: burst.complete,
    garble: burst.garble,
    trailing: burst.trailing,
    statuses: burst.statuses,
  };
}

export function summaryText(s: Summary): string {
  const parts = [
    `${s.frames} frames`,
    `${s.samples} samples`,
    s.complete ? "complete" : "incomplete",
    `${s.garble} garble`,
    `${s.statuses} statuses`,
  ];
  if (s.trailing) parts.push("trailing");
  return parts.join(", ");
}

/** One CSV column and chart series: a field's counts through one converter. */
export interface Unit extends Display {
  key: string;
  convert: (counts: number) => number;
}

const COUNTS: Display = DISPLAY.raw;
const PERCENT: Display = { unit: "%", digits: 1 };
const Q16_COUNTS: Display = { unit: "counts", digits: 1 };
const COUNTS_PER_S: Display = { unit: "counts/s", digits: 0 };

export interface StreamConfig extends TelemetryConfig {
  tickHz: number;
  iWindowMinTicks: number;
}

function realUnit(key: string, config: StreamConfig, raw: boolean): Unit | undefined {
  const { sense, cal, biases, pwmPeriodTicks } = config;
  const unit = (display: Display, convert: (c: number) => number): Unit => ({
    key,
    ...display,
    convert,
  });
  switch (key) {
    case "pos":
      return raw ? undefined : unit(DISPLAY.position, (c) => positionDeg(c, cal));
    case "theta_hat_q16":
      return raw
        ? unit(Q16_COUNTS, (c) => c / Q16)
        : unit(DISPLAY.position, (c) => positionDeg(c / Q16, cal));
    case "omega_hat_cps":
      return raw
        ? unit(COUNTS_PER_S, (c) => c / Q16)
        : unit(DISPLAY.velocity, (c) => velocityDegPerS(c / Q16, cal));
    // The kernel's own bias-subtracted counts: no bias to take out again.
    case "i_tick_counts":
    case "tau_d_counts":
    case "i_lim_counts":
      return unit(DISPLAY.current, (c) => currentMa(c, 0, sense));
    case "current_trough":
    case "current_raw":
      return unit(DISPLAY.current, (c) => currentMa(c, biases.currentBiasCounts, sense));
    case "duty_ticks":
      return unit(PERCENT, (c) => dutyTicksPercent(c, pwmPeriodTicks));
    case "vdiff_counts":
      return unit(DISPLAY.motorVoltage, (c) => vdiffV(c, 0, sense));
    case "vbus_raw":
    case "vbus_counts":
      return unit(DISPLAY.busVoltage, (c) => busV(c, sense));
    case "vmotor_a":
    case "vmotor_b":
    case "vmotor_a_trough":
    case "vmotor_b_trough":
      return unit(DISPLAY.motorVoltage, (c) => motorV(c, biases.vmotorBiasCounts, sense));
    case "ntc_raw":
      return unit(DISPLAY.temperature, (c) => temperatureC(c, sense));
    case "t_winding_cc":
      return unit(DISPLAY.temperature, windingC);
    default:
      return undefined;
  }
}

/**
 * Real units through the servo's own sense chain and calibration; the raw
 * preference reverts the position family to counts, the electrical fields
 * stay real. Without a config, or for a field with no conversion, counts.
 */
export function unitsFor(
  columns: readonly Pick<TelColumn, "name">[],
  config: StreamConfig | undefined,
  raw: boolean,
): Unit[] {
  return columns.map(
    ({ name }) =>
      (config === undefined ? undefined : realUnit(name, config, raw)) ?? {
        key: name,
        ...COUNTS,
        convert: (c) => c,
      },
  );
}

export function familyOf(key: string): Family {
  return FIELDS.find((f) => f.key === key)?.family ?? "electrical";
}

export function csvHeader(units: readonly Unit[]): string {
  return ["sample", "valid", ...units.map((u) => `${u.key} (${u.unit})`)].join(",");
}

/** Header, then one line per row; a value the row lacks is an empty cell. */
export function toCsv(rows: readonly Row[], units: readonly Unit[]): string {
  const lines = [csvHeader(units)];
  for (const row of rows) {
    const cells = units.map((u) => {
      const counts = row.values[u.key];
      return counts === undefined ? "" : fixed(u.convert(counts), u.digits);
    });
    const valid = row.valid === undefined ? "" : row.valid ? 1 : 0;
    lines.push([row.sample, valid, ...cells].join(","));
  }
  return `${lines.join("\n")}\n`;
}
