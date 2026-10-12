// The Stream tab minus React: the TEL burst frame layout (protocol sec 5.6),
// the mask that picks a row's fields and its admission at the line's rate,
// the decoder (rows unpack through osc-protocol in the wasm), and the CSV
// export.

import { telDecodeRow, telRowBytes, type BaudRate } from "@openservocore/client";
import { BAUD_RATES, fixed, formatBaud } from "./format";
import { q4ToCounts } from "./pos-lut";
import type { TelemetryConfig } from "./telemetry";
import {
  busV,
  currentMa,
  DISPLAY,
  motorV,
  positionDeg,
  temperatureC,
  vdiffV,
  type Display,
} from "./units";

/** Payload bytes before the samples: stream_seq, flags, valid bitmap. */
export const STREAM_HDR = 4;
/** One frame batches up to 16 fast-tick samples; a seq hole is 16 samples. */
export const SAMPLES_PER_FRAME = 16;
const FLAG_LAST = 1;
const MASK_ALL = 0xfff;
/** capability_flags bit 0: tel_wide_fields and tel_row_bytes_max are published. */
export const CAP_TEL_ROWS = 1;

export type Family = "position" | "electrical";

/** In `tel_mask` bit order. `key` is the firmware's TelSample name, so a CSV column names it. */
export const FIELDS = [
  { key: "pos", label: "Position", bit: 0, family: "position" },
  { key: "current", label: "Current", bit: 1, family: "electrical" },
  { key: "current_trough", label: "Current trough", bit: 2, family: "electrical" },
  // Signed PWM compare counts; full scale is pwm_period_ticks.
  { key: "duty", label: "Duty", bit: 3, family: "electrical" },
  { key: "vdiff", label: "Motor V", bit: 4, family: "electrical" },
  { key: "vbus", label: "Bus V", bit: 5, family: "electrical" },
  { key: "current_raw", label: "Current raw", bit: 6, family: "electrical" },
  { key: "vmotor_a", label: "Motor A", bit: 7, family: "electrical" },
  { key: "vmotor_b", label: "Motor B", bit: 8, family: "electrical" },
  { key: "vbus_raw", label: "Bus raw", bit: 9, family: "electrical" },
  { key: "ntc_raw", label: "NTC raw", bit: 10, family: "electrical" },
  // The Q4 word the kernel controlled on that tick (protocol sec 5.7).
  { key: "pos_lin", label: "Position (linearized)", bit: 11, family: "position" },
] as const satisfies readonly {
  key: string;
  label: string;
  bit: number;
  family: Family;
}[];

export type FieldDef = (typeof FIELDS)[number];
export type FieldKey = FieldDef["key"];

/** Position, the raw current window, both terminal taps and the raw bus tap. */
export const DEFAULT_FIELDS: readonly FieldKey[] = [
  "pos",
  "current_raw",
  "vmotor_a",
  "vmotor_b",
  "vbus_raw",
];

export function maskOf(keys: Iterable<FieldKey>): number {
  let mask = 0;
  for (const key of keys) {
    const field = FIELDS.find((f) => f.key === key);
    if (field !== undefined) mask |= 1 << field.bit;
  }
  return mask;
}

/** The mask's fields in bit order. */
export function fieldsOf(mask: number): FieldDef[] {
  return FIELDS.filter((f) => (mask & (1 << f.bit)) !== 0);
}

/**
 * The longest row the servo streams at `baud`: its `tel_row_bytes_max` entry
 * at that rate's index, or undefined when `capability_flags` says the
 * firmware publishes none.
 */
export function rowBytesMax(caps: number, perRate: Uint8Array, baud: BaudRate): number | undefined {
  if ((caps & CAP_TEL_ROWS) === 0) return undefined;
  return perRate[BAUD_RATES.indexOf(baud)];
}

/**
 * Why the servo would not stream this mask at `baud`, or undefined. An arm
 * whose row outgrows the limit acks and then disarms, so the host checks
 * first, as osc does.
 */
export function maskIssue(
  mask: number,
  baud: BaudRate,
  max: number | undefined,
): string | undefined {
  if ((mask & ~MASK_ALL) !== 0) return "mask has reserved bits set";
  if (fieldsOf(mask).length === 0) return "pick at least one field";
  if (max === undefined) {
    return "the servo publishes no TEL row limits: its firmware predates packed TEL rows";
  }
  const row = telRowBytes(mask);
  if (row > max) {
    return `these fields pack to ${row} B rows; the servo streams rows of at most ${max} B at ${formatBaud(baud)}. Raise the speed or capture the fields over two bursts.`;
  }
  return undefined;
}

export interface Row {
  /** Fast-tick index from the arm; a dropped frame leaves 16 missing indices. */
  sample: number;
  /** This tick's drive window met the sampling floors (the frame's `valid` bitmap). */
  valid: boolean;
  values: Partial<Record<FieldKey, number>>;
}

/**
 * Splits the CRC-clean stream payloads of one burst into rows. Sample `i` of
 * the frame with unwrapped index `k` is sample `16k + i`: the u8 stream_seq
 * is unwrapped against the previous frame, and a burst arms at seq 0, so a
 * nonzero first seq is missed frames too. A payload that cannot be a
 * `mask` frame (short header, ragged remainder, over 16 samples) is skipped.
 */
export function decodeBurst(frames: readonly Uint8Array[], mask: number): Row[] {
  const fields = fieldsOf(mask);
  const len = telRowBytes(mask);
  const rows: Row[] = [];
  let lastSeq: number | undefined;
  let frameIdx = 0;
  for (const payload of frames) {
    if (payload.length < STREAM_HDR) continue;
    const seq = payload[0] ?? 0;
    const idx = lastSeq === undefined ? seq : frameIdx + ((seq - lastSeq) & 0xff);
    lastSeq = seq;
    frameIdx = idx;
    const body = payload.length - STREAM_HDR;
    if (len === 0 || body % len !== 0 || body / len > SAMPLES_PER_FRAME) continue;
    const valid = (payload[2] ?? 0) | ((payload[3] ?? 0) << 8);
    for (let i = 0; i < body / len; i++) {
      const at = STREAM_HDR + i * len;
      const decoded = telDecodeRow(mask, payload.subarray(at, at + len));
      const values: Partial<Record<FieldKey, number>> = {};
      for (const f of fields) values[f.key] = decoded?.[f.bit];
      rows.push({ sample: idx * SAMPLES_PER_FRAME + i, valid: (valid & (1 << i)) !== 0, values });
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
  key: FieldKey;
  convert: (counts: number) => number;
}

const COUNTS: Display = DISPLAY.raw;
const PERCENT: Display = { unit: "%", digits: 1 };
/** Linearized counts carry a 1/16 fraction. */
const LIN_COUNTS: Display = { unit: "counts", digits: 1 };

export interface StreamConfig extends TelemetryConfig {
  tickHz: number;
  pwmPeriodTicks: number;
}

/**
 * Real units through the servo's own sense chain and calibration; the raw
 * preference reverts the position family to counts, the electrical fields
 * stay real. Without a config every field is counts.
 */
export function unitsFor(mask: number, config: StreamConfig | undefined, raw: boolean): Unit[] {
  return fieldsOf(mask).map((f) => {
    const counts: Unit = { key: f.key, ...COUNTS, convert: (c) => c };
    if (f.key === "pos_lin" && (config === undefined || raw)) {
      return { key: f.key, ...LIN_COUNTS, convert: q4ToCounts };
    }
    if (config === undefined) return counts;
    const { sense, cal, biases, pwmPeriodTicks } = config;
    switch (f.key) {
      case "pos":
        return raw
          ? counts
          : { key: f.key, ...DISPLAY.position, convert: (c) => positionDeg(c, cal) };
      // The stops map to themselves, so the same angle map applies.
      case "pos_lin":
        return { key: f.key, ...DISPLAY.position, convert: (c) => positionDeg(q4ToCounts(c), cal) };
      // The kernel's own bias-subtracted sample: no bias to take out again.
      case "current":
        return { key: f.key, ...DISPLAY.current, convert: (c) => currentMa(c, 0, sense) };
      case "current_trough":
      case "current_raw":
        return {
          key: f.key,
          ...DISPLAY.current,
          convert: (c) => currentMa(c, biases.currentBiasCounts, sense),
        };
      case "duty":
        return { key: f.key, ...PERCENT, convert: (c) => (c / pwmPeriodTicks) * 100 };
      case "vdiff":
        return { key: f.key, ...DISPLAY.motorVoltage, convert: (c) => vdiffV(c, 0, sense) };
      case "vbus":
      case "vbus_raw":
        return { key: f.key, ...DISPLAY.busVoltage, convert: (c) => busV(c, sense) };
      case "vmotor_a":
      case "vmotor_b":
        return {
          key: f.key,
          ...DISPLAY.motorVoltage,
          convert: (c) => motorV(c, biases.vmotorBiasCounts, sense),
        };
      case "ntc_raw":
        return { key: f.key, ...DISPLAY.temperature, convert: (c) => temperatureC(c, sense) };
    }
  });
}

export function familyOf(key: FieldKey): Family {
  return FIELDS.find((f) => f.key === key)?.family ?? "electrical";
}

export function csvHeader(units: readonly Unit[]): string {
  return ["sample", "valid", ...units.map((u) => `${u.key} (${u.unit})`)].join(",");
}

/** Header, then one line per row; a field the row lacks is an empty cell. */
export function toCsv(rows: readonly Row[], units: readonly Unit[]): string {
  const lines = [csvHeader(units)];
  for (const row of rows) {
    const cells = units.map((u) => {
      const counts = row.values[u.key];
      return counts === undefined ? "" : fixed(u.convert(counts), u.digits);
    });
    lines.push([row.sample, row.valid ? 1 : 0, ...cells].join(","));
  }
  return `${lines.join("\n")}\n`;
}
