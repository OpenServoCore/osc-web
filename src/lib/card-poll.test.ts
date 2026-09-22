import type { Field } from "@openservocore/client";
import { expect, test } from "vitest";
import descriptor from "../../../open-servo-core/descriptors/osc-servo/0.1.json";
import {
  CONSTANT_REGISTERS,
  constantsFrom,
  decodeSpan,
  faultText,
  LIVE_REGISTERS,
  liveFrom,
  plan,
  span,
} from "./card-poll";

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

test("the live and constants layouts decode from a whole-table image", () => {
  const image = new Uint8Array(descriptor.table_size);
  const view = new DataView(image.buffer);
  const put = (name: string, value: number) => {
    const f = fields.find((f) => f.name === name);
    if (f === undefined) throw new Error(name);
    if (f.width === 2) {
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
  const p = plan(fields);
  const constants = constantsFrom(
    decodeSpan(
      fields,
      p.constants,
      image.subarray(p.constants.addr, p.constants.addr + p.constants.count),
    ),
  );
  expect(constants.calibration).toEqual({
    rawMin: 118,
    rawMax: 3990,
    angleMinCdeg: -9500,
    angleMaxCdeg: 9500,
    gearRatioCenti: 100,
  });
  expect(constants.sense.gainMilli).toBe(32000);
  expect(constants.calibrated.valid).toBe(true);
  const live = liveFrom(
    decodeSpan(fields, p.live, image.subarray(p.live.addr, p.live.addr + p.live.count)),
  );
  expect(live).toEqual({
    pos: 2054,
    current: 2100,
    vbusRaw: 3072,
    ntcRaw: 1500,
    biases: { currentBiasCounts: 2048, vmotorBiasCounts: 700 },
  });
});

test("faultText names the latched bits, lowest first", () => {
  expect(faultText(0)).toBeUndefined();
  expect(faultText(1 << 2)).toBe("Stall detected");
  expect(faultText((1 << 0) | (1 << 5))).toBe("Overcurrent, Undervoltage");
  expect(faultText(1 << 7)).toBe("Fault 0x80");
});
