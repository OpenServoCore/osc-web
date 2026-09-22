// The Live page's telemetry poll: the conversion registers once, then one READ
// over the sample registers per tick. Everything but `startTelemetry` is pure.

import type { Kind } from "@openservocore/client";
import {
  biasesFromTable,
  calibrationFromTable,
  senseFromTable,
  type Biases,
  type Calibration,
  type ReadRegister,
  type Sense,
} from "./units";

export const POLL_HZ = 10;
export const WINDOW_S = 30;
/** Largest READ reply one frame carries (protocol sec 3.1). */
export const READ_MAX = 252;
/** omega_hat_cps is csQ16, (counts/s) x 2^16 (firmware regions/telemetry.rs). */
const Q16 = 2 ** 16;

/** The descriptor's `Field`, narrowed to what a span needs. */
export interface FieldInfo {
  name: string;
  addr: number;
  width: number;
  kind: Kind;
}

/** One contiguous READ covering `fields`. */
export interface Span {
  addr: number;
  count: number;
  fields: FieldInfo[];
}

/** One poll in device counts: `velocity` is counts/s, `t` seconds. */
export interface Sample {
  t: number;
  pos: number;
  goal: number;
  velocity: number;
  current: number;
  vbus: number;
  vmotorA: number;
  vmotorB: number;
  ntc: number;
}

export interface TelemetryConfig {
  sense: Sense;
  cal: Calibration;
  biases: Biases;
}

export const SAMPLE_REGISTERS: readonly string[] = [
  "goal_position",
  "omega_hat_cps",
  "pos",
  "current",
  "vmotor_a",
  "vmotor_b",
  "vbus_raw",
  "ntc_raw",
];

/** The registers a units binder reads, so the list lives in one place. */
export function registersOf(binder: (read: ReadRegister) => unknown): string[] {
  const names: string[] = [];
  binder((name) => {
    names.push(name);
    return 0;
  });
  return names;
}

export const CONFIG_REGISTERS: readonly string[] = [
  ...registersOf(senseFromTable),
  ...registersOf(calibrationFromTable),
];
export const BIAS_REGISTERS: readonly string[] = registersOf(biasesFromTable);

export function spanOver(fields: readonly FieldInfo[], names: readonly string[]): Span {
  const picked = names.map((name) => {
    const field = fields.find((f) => f.name === name);
    if (field === undefined) throw new Error(`descriptor has no ${name}`);
    return field;
  });
  const addr = Math.min(...picked.map((f) => f.addr));
  const count = Math.max(...picked.map((f) => f.addr + f.width)) - addr;
  if (count > READ_MAX) throw new Error(`${count} bytes do not fit one READ`);
  return { addr, count, fields: picked };
}

// Decodes from the span's own layout, never the descriptor object: a new
// selection frees that while a read is still in flight.
export function decodeSpan(span: Span, bytes: Uint8Array): ReadRegister {
  if (bytes.length !== span.count) {
    throw new Error(`read returned ${bytes.length} bytes, expected ${span.count}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return (name) => {
    const field = span.fields.find((f) => f.name === name);
    if (field === undefined) throw new Error(`span has no ${name}`);
    return decodeField(view, field.addr - span.addr, field);
  };
}

function decodeField(view: DataView, offset: number, { name, width, kind }: FieldInfo): number {
  if (kind !== "uint" && kind !== "int") throw new Error(`${name} is ${kind}, not a number`);
  const signed = kind === "int";
  switch (width) {
    case 1:
      return signed ? view.getInt8(offset) : view.getUint8(offset);
    case 2:
      return signed ? view.getInt16(offset, true) : view.getUint16(offset, true);
    case 4:
      return signed ? view.getInt32(offset, true) : view.getUint32(offset, true);
    default:
      throw new Error(`${name} is ${width} bytes wide`);
  }
}

export function decodeSample(span: Span, bytes: Uint8Array, t: number): Sample {
  const read = decodeSpan(span, bytes);
  return {
    t,
    pos: read("pos"),
    goal: read("goal_position"),
    velocity: read("omega_hat_cps") / Q16,
    current: read("current"),
    vbus: read("vbus_raw"),
    vmotorA: read("vmotor_a"),
    vmotorB: read("vmotor_b"),
    ntc: read("ntc_raw"),
  };
}

/** The last `windowS` seconds of samples, oldest first. */
export class SampleRing {
  private buf: Sample[] = [];

  constructor(private readonly windowS: number) {}

  push(sample: Sample): void {
    this.buf.push(sample);
    const cutoff = sample.t - this.windowS;
    let drop = 0;
    for (const s of this.buf) {
      if (s.t >= cutoff) break;
      drop++;
    }
    if (drop > 0) this.buf.splice(0, drop);
  }

  /** A fresh array each call, so a render can key on it. */
  get samples(): Sample[] {
    return this.buf.slice();
  }
}

export interface TelemetryOptions {
  fields: readonly FieldInfo[];
  /** Resolves undefined when the read was skipped (a command was in flight). */
  read: (addr: number, count: number) => Promise<Uint8Array | undefined>;
  /** Seconds. */
  now: () => number;
  periodMs: number;
  onConfig: (config: TelemetryConfig) => void;
  onSample: (sample: Sample) => void;
  onError: (error: unknown) => void;
}

type Phase = { name: "config" } | { name: "biases"; config: ReadRegister } | { name: "samples" };

/**
 * Ticks every `periodMs`: the sense and calibration span, then the bias span,
 * then the sample span until stopped. A tick whose read is skipped retries the
 * same phase next tick. The first error stops the poll.
 */
export function startTelemetry(o: TelemetryOptions): () => void {
  const spans = {
    config: spanOver(o.fields, CONFIG_REGISTERS),
    biases: spanOver(o.fields, BIAS_REGISTERS),
    samples: spanOver(o.fields, SAMPLE_REGISTERS),
  };
  let phase: Phase = { name: "config" };
  let stopped = false;

  async function tick(): Promise<void> {
    const span = spans[phase.name];
    const bytes = await o.read(span.addr, span.count);
    if (stopped || bytes === undefined) return;
    switch (phase.name) {
      case "config":
        phase = { name: "biases", config: decodeSpan(span, bytes) };
        break;
      case "biases": {
        const { config } = phase;
        o.onConfig({
          sense: senseFromTable(config),
          cal: calibrationFromTable(config),
          biases: biasesFromTable(decodeSpan(span, bytes)),
        });
        phase = { name: "samples" };
        break;
      }
      case "samples":
        o.onSample(decodeSample(span, bytes, o.now()));
        break;
    }
  }

  const stop = (): void => {
    stopped = true;
    clearInterval(timer);
  };
  const guarded = (): void => {
    tick().catch((e: unknown) => {
      if (stopped) return;
      stop();
      o.onError(e);
    });
  };
  const timer = setInterval(guarded, o.periodMs);
  guarded();
  return stop;
}
