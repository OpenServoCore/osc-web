// Register names to the reads that carry them, and the bytes back to values.
// Pure: no client, no clock, no React.

import type { Descriptor, Field, Health, Value } from "@openservocore/client";
import {
  biasesFromTable,
  calibrationFromTable,
  calibrationStatus,
  senseFromTable,
  type Biases,
  type Calibration,
  type CalibrationStatus,
  type ReadRegister,
  type Sense,
} from "../units";

/** A READ payload is at most 252 bytes (protocol sec 5.1). */
export const READ_MAX = 252;

/** `status_flags` bit 0: modified since the last save (protocol sec 9.4). */
const STATUS_FLAG_CONFIG_DIRTY = 1 << 0;

export interface Span {
  addr: number;
  count: number;
}

/** The slice of a descriptor the scheduler plans and decodes through. */
export interface Layout {
  encode: Descriptor["encode"];
  decode: Descriptor["decode"];
  fields: readonly Field[];
}

export function field(fields: readonly Field[], name: string): Field {
  const f = fields.find((f) => f.name === name);
  if (f === undefined) throw new Error(`descriptor has no ${name}`);
  return f;
}

/** The field lies wholly inside the span. */
export function within(span: Span, f: Field): boolean {
  return f.addr >= span.addr && f.addr + f.width <= span.addr + span.count;
}

/** The one contiguous read covering every named register. */
export function span(fields: readonly Field[], names: readonly string[]): Span {
  let lo = Infinity;
  let hi = -Infinity;
  for (const name of names) {
    const f = field(fields, name);
    lo = Math.min(lo, f.addr);
    hi = Math.max(hi, f.addr + f.width);
  }
  return { addr: lo, count: hi - lo };
}

/**
 * The fewest reads covering `names`, fields in address order, each joined to
 * the span before it unless that would pass READ_MAX. Gaps are read through:
 * a byte costs a few microseconds, a second exchange a millisecond or more.
 * Fields already inside a `served` span get no span of their own.
 */
export function planSpans(
  fields: readonly Field[],
  names: readonly string[],
  served: readonly Span[] = [],
): Span[] {
  const picked = [...new Set(names)]
    .map((name) => field(fields, name))
    .filter((f) => !served.some((s) => within(s, f)))
    .sort((a, b) => a.addr - b.addr);
  const spans: Span[] = [];
  for (const f of picked) {
    const last = spans.at(-1);
    const end = f.addr + f.width;
    if (last !== undefined && end - last.addr <= READ_MAX) {
      last.count = Math.max(last.count, end - last.addr);
    } else {
      spans.push({ addr: f.addr, count: f.width });
    }
  }
  return spans;
}

/** Every field the read covered, decoded once through the descriptor's codec. */
export function decodeValues(layout: Layout, span: Span, bytes: Uint8Array): Map<string, Value> {
  const end = span.addr + Math.min(span.count, bytes.length);
  const values = new Map<string, Value>();
  for (const f of layout.fields) {
    if (f.addr < span.addr || f.addr + f.width > end) continue;
    const at = f.addr - span.addr;
    values.set(f.name, layout.decode(f.name, bytes.subarray(at, at + f.width)));
  }
  return values;
}

/** A numeric reader over decoded values; bools read as 0 or 1. */
export function readerOver(values: ReadonlyMap<string, Value>): ReadRegister {
  return (name) => {
    const v = values.get(name);
    if (v === undefined) throw new Error(`${name} outside the read`);
    if (v.kind === "bytes") throw new Error(`${name} is not a number`);
    return typeof v.value === "boolean" ? Number(v.value) : v.value;
  };
}

/** A register reader over the bytes one `span` read returned. */
export function decodeSpan(fields: readonly Field[], span: Span, bytes: Uint8Array): ReadRegister {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return (name) => {
    const f = field(fields, name);
    const at = f.addr - span.addr;
    if (at < 0 || at + f.width > bytes.byteLength) throw new Error(`${name} outside the read`);
    const signed = f.kind === "int";
    switch (f.width) {
      case 1:
        return signed ? view.getInt8(at) : view.getUint8(at);
      case 2:
        return signed ? view.getInt16(at, true) : view.getUint16(at, true);
      case 4:
        return signed ? view.getInt32(at, true) : view.getUint32(at, true);
      default:
        throw new Error(`${name} is not a number`);
    }
  };
}

/** CALIB pot_lut, kinematics, sense and sense_ext: read once per servo. */
export const CONSTANT_REGISTERS: readonly string[] = [
  "raw_min",
  "raw_max",
  "angle_min_cdeg",
  "angle_max_cdeg",
  "gear_ratio_centi",
  "shunt_r_mohm",
  "gain_milli",
  "vdd_mv",
  "vmotor_div_top",
  "vmotor_div_bot",
  "vbus_div_top_ohm",
  "vbus_div_bot_ohm",
  "ntc_pullup_ohm",
  "ntc_r25_ohm",
  "ntc_beta",
  "vmotor_bias_nom_counts",
];

/** TELEMETRY sensors the cards show, plus the biases their conversion needs. */
export const LIVE_REGISTERS: readonly string[] = [
  "pos",
  "current",
  "vbus_raw",
  "ntc_raw",
  "current_bias_counts",
  "vmotor_bias_counts",
];

/** TELEMETRY-COMMON front, the fields `OscClient.health` reads as one block. */
export const HEALTH_REGISTERS: readonly string[] = [
  "fault_flags",
  "status_flags",
  "trim_steps",
  "crc_fail_count",
  "framing_drop_count",
];

export interface Plan {
  fields: Field[];
  constants: Span;
  live: Span;
}

export function plan(fields: Field[]): Plan {
  return {
    fields,
    constants: span(fields, CONSTANT_REGISTERS),
    live: span(fields, LIVE_REGISTERS),
  };
}

export interface Constants {
  sense: Sense;
  calibration: Calibration;
  calibrated: CalibrationStatus;
}

export function constantsFrom(read: ReadRegister): Constants {
  const calibration = calibrationFromTable(read);
  return { sense: senseFromTable(read), calibration, calibrated: calibrationStatus(calibration) };
}

export interface Live {
  pos: number;
  current: number;
  vbusRaw: number;
  ntcRaw: number;
  biases: Biases;
}

export function liveFrom(read: ReadRegister): Live {
  return {
    pos: read("pos"),
    current: read("current"),
    vbusRaw: read("vbus_raw"),
    ntcRaw: read("ntc_raw"),
    biases: biasesFromTable(read),
  };
}

export function healthFrom(read: ReadRegister): Health {
  return {
    faultFlags: read("fault_flags"),
    configDirty: (read("status_flags") & STATUS_FLAG_CONFIG_DIRTY) !== 0,
    trimSteps: read("trim_steps"),
    crcFailCount: read("crc_fail_count"),
    framingDropCount: read("framing_drop_count"),
  };
}

export interface CardValues {
  constants: Constants;
  live: Live;
  health: Health;
}

/** Kernel fault latch bits (firmware kernel/faults.rs), lowest bit first. */
const FAULTS: readonly string[] = [
  "Overcurrent",
  "Overheated",
  "Stall detected",
  "Position error",
  "Sensor fault",
  "Undervoltage",
];

export function faultText(faultFlags: number): string | undefined {
  const set = FAULTS.filter((_, bit) => (faultFlags & (1 << bit)) !== 0);
  if (set.length === 0) return faultFlags === 0 ? undefined : `Fault 0x${faultFlags.toString(16)}`;
  return set.join(", ");
}
