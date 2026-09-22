import { expect, test } from "vitest";
import { parseSimIds } from "./backend";

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

test("parseSimIds drops duplicates", () => {
  expect(parseSimIds("?sim=2,1,2,1")).toEqual([2, 1]);
});
