import type { Field, Value } from "@openservocore/client";
import { expect, test } from "vitest";
import descriptor from "../../../../open-servo-core/descriptors/osc-servo/0.1.json";
import {
  CONSTANT_REGISTERS,
  constantsFrom,
  decodeSpan,
  decodeValues,
  faultText,
  healthFrom,
  HEALTH_REGISTERS,
  liveFrom,
  LIVE_REGISTERS,
  plan,
  planSpans,
  readerOver,
  READ_MAX,
  span,
  within,
  type Layout,
} from "./spans";

const fields = descriptor.fields as Field[];

test("the live span is one read from pos through vmotor_bias_counts", () => {
  expect(span(fields, LIVE_REGISTERS)).toEqual({ addr: 576, count: 26 });
});

test("the constants span is one read from raw_min through vmotor_bias_nom_counts", () => {
  expect(span(fields, CONSTANT_REGISTERS)).toEqual({ addr: 128, count: 172 });
});

test("plan fails loudly on a descriptor missing a register", () => {
  expect(() => plan(fields.filter((f) => f.name !== "ntc_raw"))).toThrow("ntc_raw");
});

const sample: Field[] = [
  { name: "u8", addr: 10, width: 1, access: "ro", kind: "uint", variants: [] },
  { name: "i8", addr: 11, width: 1, access: "ro", kind: "int", variants: [] },
  { name: "u16", addr: 12, width: 2, access: "ro", kind: "uint", variants: [] },
  { name: "i16", addr: 14, width: 2, access: "ro", kind: "int", variants: [] },
  { name: "u32", addr: 16, width: 4, access: "ro", kind: "uint", variants: [] },
  { name: "i32", addr: 20, width: 4, access: "ro", kind: "int", variants: [] },
  { name: "blob", addr: 24, width: 3, access: "ro", kind: "bytes", variants: [] },
  { name: "beyond", addr: 27, width: 1, access: "ro", kind: "uint", variants: [] },
];

test("decodeSpan reads little-endian widths and signs at the span offset", () => {
  const bytes = new Uint8Array([
    0xff, 0xff, 0x34, 0x12, 0xfe, 0xff, 0x78, 0x56, 0x34, 0x12, 0xff, 0xff, 0xff, 0xff, 1, 2, 3,
  ]);
  const read = decodeSpan(sample, { addr: 10, count: bytes.length }, bytes);
  expect(read("u8")).toBe(255);
  expect(read("i8")).toBe(-1);
  expect(read("u16")).toBe(0x1234);
  expect(read("i16")).toBe(-2);
  expect(read("u32")).toBe(0x12345678);
  expect(read("i32")).toBe(-1);
  expect(() => read("blob")).toThrow("not a number");
  expect(() => read("beyond")).toThrow("outside");
});

test("decodeSpan honours a subarray's own offset", () => {
  const backing = new Uint8Array([9, 9, 0x34, 0x12]);
  const read = decodeSpan(sample, { addr: 12, count: 2 }, backing.subarray(2));
  expect(read("u16")).toBe(0x1234);
});

test("spans merge in address order, gaps read through, a new span past READ_MAX", () => {
  const wide: Field[] = [
    { name: "a", addr: 0, width: 2, access: "ro", kind: "uint", variants: [] },
    { name: "b", addr: 100, width: 2, access: "ro", kind: "uint", variants: [] },
    { name: "c", addr: READ_MAX, width: 1, access: "ro", kind: "uint", variants: [] },
    { name: "d", addr: READ_MAX + 4, width: 1, access: "ro", kind: "uint", variants: [] },
  ];
  expect(planSpans(wide, ["d", "a", "c", "b"])).toEqual([
    { addr: 0, count: 102 },
    { addr: READ_MAX, count: 5 },
  ]);
});

test("a field already inside a served span gets no span of its own", () => {
  const served = planSpans(sample, ["u8", "u16"]);
  expect(served).toEqual([{ addr: 10, count: 4 }]);
  expect(planSpans(sample, ["i8", "i32"], served)).toEqual([{ addr: 20, count: 4 }]);
  const inside = sample.filter((f) => served.some((s) => within(s, f))).map((f) => f.name);
  expect(inside).toEqual(["u8", "i8", "u16"]);
});

test("planSpans rejects a register the descriptor does not carry", () => {
  expect(() => planSpans(sample, ["nope"])).toThrow("descriptor has no nope");
});

test("the 0.1 sample span is goal_duty through ntc_raw in one read", () => {
  expect(
    planSpans(fields, [
      "goal_duty",
      "goal_position",
      "goal_velocity",
      "goal_current",
      "mode_active",
      "omega_hat_cps",
      "duty_applied_q15",
      "pos",
      "current",
      "vmotor_a",
      "vmotor_b",
      "vbus_raw",
      "ntc_raw",
    ]),
  ).toEqual([{ addr: 390, count: 210 }]);
});

/** A descriptor codec over `sample`, plain numbers only. */
const layout: Layout = {
  fields: sample,
  decode: (name, bytes) => {
    const f = sample.find((f) => f.name === name);
    if (f === undefined) throw new Error(name);
    if (f.kind === "bytes") return { kind: "bytes", value: bytes.slice() };
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const value =
      f.width === 1
        ? f.kind === "int"
          ? view.getInt8(0)
          : view.getUint8(0)
        : f.width === 2
          ? f.kind === "int"
            ? view.getInt16(0, true)
            : view.getUint16(0, true)
          : f.kind === "int"
            ? view.getInt32(0, true)
            : view.getUint32(0, true);
    return { kind: f.kind === "int" ? "int" : "uint", value };
  },
  encode: () => new Uint8Array(),
};

test("decodeValues covers every field wholly inside the read, and no more", () => {
  const bytes = Uint8Array.from({ length: 6 }, (_, i) => i + 1);
  const values = decodeValues(layout, { addr: 10, count: 6 }, bytes);
  expect([...values.keys()]).toEqual(["u8", "i8", "u16", "i16"]);
  expect(values.get("u16")).toEqual({ kind: "uint", value: 0x0403 } satisfies Value);
});

test("decodeValues stops at a short reply instead of reading past it", () => {
  const values = decodeValues(layout, { addr: 10, count: 6 }, new Uint8Array([1, 2, 3]));
  expect([...values.keys()]).toEqual(["u8", "i8"]);
});

test("readerOver throws for a name outside the read and for a bytes field", () => {
  const read = readerOver(
    new Map<string, Value>([
      ["u8", { kind: "uint", value: 7 }],
      ["on", { kind: "bool", value: true }],
      ["blob", { kind: "bytes", value: new Uint8Array(1) }],
    ]),
  );
  expect(read("u8")).toBe(7);
  expect(read("on")).toBe(1);
  expect(() => read("blob")).toThrow("not a number");
  expect(() => read("missing")).toThrow("outside the read");
});

test("the live, health and constants layouts decode from a whole-table image", () => {
  const image = new Uint8Array(descriptor.table_size);
  const view = new DataView(image.buffer);
  const put = (name: string, value: number) => {
    const f = fields.find((f) => f.name === name);
    if (f === undefined) throw new Error(name);
    if (f.width === 4) view.setUint32(f.addr, value, true);
    else if (f.width === 2) {
      if (f.kind === "int") view.setInt16(f.addr, value, true);
      else view.setUint16(f.addr, value, true);
    } else view.setUint8(f.addr, value);
  };
  put("raw_min", 118);
  put("raw_max", 3990);
  put("angle_min_cdeg", -9500);
  put("angle_max_cdeg", 9500);
  put("gear_ratio_centi", 100);
  put("shunt_r_mohm", 10);
  put("gain_milli", 32000);
  put("vdd_mv", 3300);
  put("ntc_beta", 3950);
  put("pos", 2054);
  put("current", 2100);
  put("vbus_raw", 3072);
  put("ntc_raw", 1500);
  put("current_bias_counts", 2048);
  put("vmotor_bias_counts", 700);
  put("fault_flags", 0x04);
  put("status_flags", 0x01);
  put("trim_steps", 3);
  put("crc_fail_count", 9);
  put("framing_drop_count", 4);
  const read = (names: readonly string[]) => {
    const s = span(fields, names);
    return decodeSpan(fields, s, image.subarray(s.addr, s.addr + s.count));
  };
  const constants = constantsFrom(read(CONSTANT_REGISTERS));
  expect(constants.calibration).toEqual({
    rawMin: 118,
    rawMax: 3990,
    angleMinCdeg: -9500,
    angleMaxCdeg: 9500,
    gearRatioCenti: 100,
  });
  expect(constants.sense.gainMilli).toBe(32000);
  expect(constants.calibrated.valid).toBe(true);
  expect(liveFrom(read(LIVE_REGISTERS))).toEqual({
    pos: 2054,
    current: 2100,
    vbusRaw: 3072,
    ntcRaw: 1500,
    biases: { currentBiasCounts: 2048, vmotorBiasCounts: 700 },
  });
  expect(healthFrom(read(HEALTH_REGISTERS))).toEqual({
    faultFlags: 0x04,
    configDirty: true,
    trimSteps: 3,
    crcFailCount: 9,
    framingDropCount: 4,
  });
});

test("the fleet card reads the live sensors and the health block as one span", () => {
  expect(planSpans(fields, [...LIVE_REGISTERS, ...HEALTH_REGISTERS])).toEqual([
    { addr: 512, count: 90 },
  ]);
});

test("faultText names the latched bits, lowest first", () => {
  expect(faultText(0)).toBeUndefined();
  expect(faultText(1 << 2)).toBe("Stall detected");
  expect(faultText((1 << 0) | (1 << 5))).toBe("Overcurrent, Undervoltage");
  expect(faultText(1 << 7)).toBe("Fault 0x80");
});
