import type { Field, Health, OscClient } from "@openservocore/client";
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
} from "./units";

export const POLL_MS = 1000;

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

export interface Span {
  addr: number;
  count: number;
}

function field(fields: readonly Field[], name: string): Field {
  const f = fields.find((f) => f.name === name);
  if (f === undefined) throw new Error(`descriptor has no ${name}`);
  return f;
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

export interface CardValues {
  constants: Constants;
  live: Live;
  health: Health;
}

/** One card's values: the constants read only when not already known. */
export async function readCard(
  client: OscClient,
  id: number,
  plan: Plan,
  constants: Constants | undefined,
): Promise<CardValues> {
  if (constants === undefined) {
    const bytes = await client.read(id, plan.constants.addr, plan.constants.count);
    constants = constantsFrom(decodeSpan(plan.fields, plan.constants, bytes));
  }
  const bytes = await client.read(id, plan.live.addr, plan.live.count);
  const live = liveFrom(decodeSpan(plan.fields, plan.live, bytes));
  return { constants, live, health: await client.health(id) };
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
