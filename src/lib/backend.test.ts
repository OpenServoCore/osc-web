import { expect, test } from "vitest";
import { parseSimDeadlines, parseSimIds, parseSimVirgin, permittedAdapter } from "./backend";

test("parseSimIds is undefined without ?sim", () => {
  expect(parseSimIds("")).toBeUndefined();
  expect(parseSimIds("?other=1")).toBeUndefined();
});

test("bare ?sim is the two-servo fleet", () => {
  expect(parseSimIds("?sim")).toEqual([1, 2]);
  expect(parseSimIds("?sim=")).toEqual([1, 2]);
});

test("parseSimIds reads a comma list in order", () => {
  expect(parseSimIds("?sim=7,1,3")).toEqual([7, 1, 3]);
});

test("parseSimIds drops junk and out-of-range entries", () => {
  expect(parseSimIds("?sim=1,x,2.5,-3,,0,250,4")).toEqual([1, 4]);
});

test("parseSimVirgin names the factory-fresh ids, none by default", () => {
  expect(parseSimVirgin("?sim=1,2")).toEqual([]);
  expect(parseSimVirgin("?sim=1,2&virgin=2")).toEqual([2]);
  expect(parseSimVirgin("?sim=1,2&virgin=2,x,300,1")).toEqual([2, 1]);
});

test("parseSimDeadlines maps ids to the deadline they hold, none by default", () => {
  expect(parseSimDeadlines("?sim=1,2")).toEqual(new Map());
  expect(parseSimDeadlines("?sim=1,2&deadline=2:400")).toEqual(new Map([[2, 400]]));
  expect(parseSimDeadlines("?deadline=2:400,x,0:5,300:5,3:65536,1:2.5,4:0")).toEqual(
    new Map([
      [2, 400],
      [4, 0],
    ]),
  );
});

test("parseSimIds drops duplicates", () => {
  expect(parseSimIds("?sim=2,1,2,1")).toEqual([2, 1]);
});

const ADAPTER = { vendorId: 0x1209, productId: 0x0001 };

test("permittedAdapter picks the device with the adapter's ids", () => {
  const other = { vendorId: 0x1209, productId: 0x0002 };
  expect(permittedAdapter([other, ADAPTER], 0x1209, 0x0001)).toBe(ADAPTER);
});

test("permittedAdapter is undefined when nothing matches", () => {
  const none: (typeof ADAPTER)[] = [];
  expect(permittedAdapter(none, 0x1209, 0x0001)).toBeUndefined();
  expect(
    permittedAdapter([{ vendorId: 0x1209, productId: 0x0002 }], 0x1209, 0x0001),
  ).toBeUndefined();
});
