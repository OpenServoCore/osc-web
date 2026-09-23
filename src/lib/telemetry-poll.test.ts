import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  BIAS_REGISTERS,
  CONFIG_REGISTERS,
  decodeSample,
  decodeSpan,
  READ_MAX,
  registersOf,
  SAMPLE_REGISTERS,
  SampleRing,
  spanOver,
  startTelemetry,
  type FieldInfo,
  type Sample,
  type TelemetryConfig,
} from "./telemetry-poll";

const descriptor = JSON.parse(
  readFileSync(
    new URL("../../../open-servo-core/descriptors/osc-servo/0.1.json", import.meta.url),
    "utf8",
  ),
) as { fields: FieldInfo[] };
const { fields } = descriptor;

const field = (name: string, addr: number, width: number, kind: FieldInfo["kind"]): FieldInfo => ({
  name,
  addr,
  width,
  kind,
});

test("spanOver covers the named fields from the lowest address to the highest end", () => {
  const span = spanOver(
    [field("a", 10, 2, "uint"), field("b", 4, 4, "int"), field("c", 20, 1, "uint")],
    ["a", "c"],
  );
  expect(span).toMatchObject({ addr: 10, count: 11 });
  expect(span.fields.map((f) => f.name)).toEqual(["a", "c"]);
});

test("spanOver rejects a missing register and a span over one READ", () => {
  expect(() => spanOver([field("a", 0, 2, "uint")], ["b"])).toThrow("descriptor has no b");
  expect(() =>
    spanOver([field("a", 0, 2, "uint"), field("z", READ_MAX, 1, "uint")], ["a", "z"]),
  ).toThrow("do not fit one READ");
});

test("the sample span over the 0.1 descriptor is goal_duty through ntc_raw", () => {
  const span = spanOver(fields, SAMPLE_REGISTERS);
  expect(span.addr).toBe(390);
  expect(span.count).toBe(210);
});

test("the config and bias spans over the 0.1 descriptor fit one READ each", () => {
  expect(spanOver(fields, CONFIG_REGISTERS)).toMatchObject({ addr: 128, count: 172 });
  expect(spanOver(fields, BIAS_REGISTERS)).toMatchObject({ addr: 594, count: 8 });
});

test("registersOf lists what a binder reads, in order", () => {
  expect(registersOf((read) => [read("x"), read("y")])).toEqual(["x", "y"]);
});

test("decodeSpan reads little-endian values by width and sign", () => {
  const span = spanOver(
    [
      field("u8", 100, 1, "uint"),
      field("i8", 101, 1, "int"),
      field("u16", 102, 2, "uint"),
      field("i16", 104, 2, "int"),
      field("u32", 106, 4, "uint"),
      field("i32", 110, 4, "int"),
    ],
    ["u8", "i8", "u16", "i16", "u32", "i32"],
  );
  const bytes = new Uint8Array([
    0xff, 0xff, 0x34, 0x12, 0xfe, 0xff, 0x78, 0x56, 0x34, 0x12, 0xfd, 0xff, 0xff, 0xff,
  ]);
  const read = decodeSpan(span, bytes);
  expect(read("u8")).toBe(255);
  expect(read("i8")).toBe(-1);
  expect(read("u16")).toBe(0x1234);
  expect(read("i16")).toBe(-2);
  expect(read("u32")).toBe(0x12345678);
  expect(read("i32")).toBe(-3);
  expect(() => read("nope")).toThrow("span has no nope");
  const flags = spanOver([field("on", 0, 1, "bool"), field("mode", 1, 1, "enum")], ["on", "mode"]);
  const readFlags = decodeSpan(flags, new Uint8Array([1, 3]));
  expect(readFlags("on")).toBe(1);
  expect(readFlags("mode")).toBe(3);
  expect(() => decodeSpan(span, bytes.subarray(1))).toThrow("expected 14");
});

test("decodeSample scales omega_hat_cps out of Q16 and keeps the rest in counts", () => {
  const span = spanOver(fields, SAMPLE_REGISTERS);
  const bytes = new Uint8Array(span.count);
  const view = new DataView(bytes.buffer);
  const at = (name: string) => {
    const f = fields.find((x) => x.name === name);
    if (f === undefined) throw new Error(name);
    return f.addr - span.addr;
  };
  view.setInt16(at("goal_duty"), -1000, true);
  view.setInt32(at("goal_position"), 2048, true);
  view.setInt32(at("goal_velocity"), -500, true);
  view.setInt16(at("goal_current"), 250, true);
  view.setUint8(at("mode_active"), 3);
  view.setInt32(at("omega_hat_cps"), -3 * 65536, true);
  view.setInt16(at("duty_applied_q15"), -900, true);
  view.setUint16(at("pos"), 1234, true);
  view.setUint16(at("current"), 300, true);
  view.setUint16(at("vmotor_a"), 800, true);
  view.setUint16(at("vmotor_b"), 700, true);
  view.setUint16(at("vbus_raw"), 3600, true);
  view.setUint16(at("ntc_raw"), 2000, true);
  expect(decodeSample(span, bytes, 1.5)).toEqual({
    t: 1.5,
    pos: 1234,
    goal: 2048,
    goalVelocity: -500,
    goalCurrent: 250,
    goalDuty: -1000,
    dutyApplied: -900,
    modeActive: 3,
    velocity: -3,
    current: 300,
    vbus: 3600,
    vmotorA: 800,
    vmotorB: 700,
    ntc: 2000,
  });
});

const sampleAt = (t: number): Sample => ({
  t,
  pos: 0,
  goal: 0,
  goalVelocity: 0,
  goalCurrent: 0,
  goalDuty: 0,
  dutyApplied: 0,
  modeActive: 0,
  velocity: 0,
  current: 0,
  vbus: 0,
  vmotorA: 0,
  vmotorB: 0,
  ntc: 0,
});

test("the ring keeps the window's worth of samples, oldest first", () => {
  const ring = new SampleRing(30);
  for (const t of [0, 10, 20, 30, 31]) ring.push(sampleAt(t));
  expect(ring.samples.map((s) => s.t)).toEqual([10, 20, 30, 31]);
  expect(ring.samples).not.toBe(ring.samples);
});

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** A fake servo whose registers carry their own address in each byte. */
function fakeRead(): {
  calls: [number, number][];
  read: (addr: number, count: number) => Promise<Uint8Array | undefined>;
  pending: Set<(bytes: Uint8Array | undefined) => void>;
} {
  const calls: [number, number][] = [];
  const pending = new Set<(bytes: Uint8Array | undefined) => void>();
  return {
    calls,
    pending,
    read: (addr, count) => {
      calls.push([addr, count]);
      return new Promise((resolve) => {
        pending.add((bytes) => {
          pending.clear();
          resolve(bytes ?? Uint8Array.from({ length: count }, (_, i) => (addr + i) & 0xff));
        });
      });
    },
  };
}

function settle(fake: ReturnType<typeof fakeRead>, bytes?: Uint8Array): void {
  for (const resolve of fake.pending) resolve(bytes);
}

test("startTelemetry reads config, then biases, then samples on every tick", async () => {
  const fake = fakeRead();
  const configs: TelemetryConfig[] = [];
  const samples: Sample[] = [];
  let now = 0;
  const stop = startTelemetry({
    fields,
    read: fake.read,
    now: () => now,
    periodMs: 100,
    onConfig: (c) => configs.push(c),
    onSample: (s) => samples.push(s),
    onError: (e: unknown) => {
      throw e;
    },
  });
  expect(fake.calls).toEqual([[128, 172]]);
  settle(fake);
  await vi.advanceTimersByTimeAsync(100);
  expect(fake.calls).toEqual([
    [128, 172],
    [594, 8],
  ]);
  settle(fake);
  await vi.advanceTimersByTimeAsync(0);
  expect(configs).toHaveLength(1);
  expect(configs[0]?.sense.shuntMohm).toBe(0xf3f2);
  expect(configs[0]?.biases.currentBiasCounts).toBe(0x5352);
  now = 7;
  await vi.advanceTimersByTimeAsync(100);
  expect(fake.calls.at(-1)).toEqual([390, 210]);
  settle(fake);
  await vi.advanceTimersByTimeAsync(0);
  expect(samples).toHaveLength(1);
  expect(samples[0]?.t).toBe(7);
  expect(samples[0]?.pos).toBe(0x4140);
  stop();
  await vi.advanceTimersByTimeAsync(500);
  expect(fake.calls).toHaveLength(3);
});

test("a tick whose read is still pending is skipped, not queued", async () => {
  const fake = fakeRead();
  startTelemetry({
    fields,
    read: fake.read,
    now: () => 0,
    periodMs: 100,
    onConfig: () => undefined,
    onSample: () => undefined,
    onError: () => undefined,
  });
  await vi.advanceTimersByTimeAsync(350);
  expect(fake.calls).toHaveLength(4);
  const samples: Sample[] = [];
  const skipping = startTelemetry({
    fields,
    read: () => Promise.resolve(undefined),
    now: () => 0,
    periodMs: 100,
    onConfig: () => undefined,
    onSample: (s) => samples.push(s),
    onError: () => undefined,
  });
  await vi.advanceTimersByTimeAsync(1000);
  expect(samples).toHaveLength(0);
  skipping();
});

test("the first error stops the poll and is reported once", async () => {
  const errors: unknown[] = [];
  let calls = 0;
  startTelemetry({
    fields,
    read: () => {
      calls++;
      return Promise.reject(new Error("busy"));
    },
    now: () => 0,
    periodMs: 100,
    onConfig: () => undefined,
    onSample: () => undefined,
    onError: (e) => errors.push(e),
  });
  await vi.advanceTimersByTimeAsync(500);
  expect(calls).toBe(1);
  expect(errors).toHaveLength(1);
});
