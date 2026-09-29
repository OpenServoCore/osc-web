import { expect, test } from "vitest";
import image from "../../../open-servo-core/ident/testdata/lut/pot-lut-mg90-a-grid.json";
import {
  counts,
  gradeOf,
  gradeRule,
  interpQ4,
  isIdentity,
  q4,
  q4ToCounts,
  report,
  STATE,
  stateWords,
  summary,
  WINDOW,
} from "./pot-lut";

const mg90a: number[] = image.knots;
const IDENTITY: number[] = Array.from({ length: 256 }, () => 0);

test("the identity is raw << 4 exactly, and a knot lands at raw + c[k]", () => {
  for (const raw of [0, 1, 15, 16, 2048, 4095]) {
    expect(q4(IDENTITY, raw)).toBe(raw << 4);
    expect(counts(IDENTITY, raw)).toBe(raw);
  }
  expect(interpQ4(560, 4, -1)).toBe((560 + 4) << 4);
  expect(counts(mg90a, 560)).toBe(564);
  // f = 8 of 16 between corrections 4 and -1: half way from +4 to -1.
  expect(counts(mg90a, 568)).toBe(569.5);
  expect(interpQ4(4096 + 560, 4, -1)).toBe(interpQ4(560, 4, -1));
  expect(q4ToCounts(569.5 * 16)).toBe(569.5);
  expect(isIdentity(IDENTITY)).toBe(true);
  expect(isIdentity(mg90a)).toBe(false);
});

test("the mg90-a table grades A with the notebook's numbers", () => {
  const r = report(mg90a);
  expect([r.nonzero, r.span]).toEqual([185, [560, 3504]]);
  expect(r.maxAbs).toBe(71);
  expect(r.steepest?.raw).toBe(1360);
  expect(r.steepest?.gain).toBeCloseTo(2.0625, 9);
  expect(r.shallowest?.raw).toBe(752);
  expect(r.shallowest?.gain).toBeCloseTo(0.5, 9);
  expect(r.band).toEqual([544, 3520]);
  expect(r.windows?.counts).toBe(WINDOW);
  expect(r.windows?.min).toBeCloseTo(0.6125, 9);
  expect(r.windows?.max).toBeCloseTo(1.8825, 9);
  expect(r.grade).toBe("A");
  expect(r.gains).toHaveLength(256);
  expect(r.gains[1360 / 16]).toBeCloseTo(2.0625, 9);
  expect(summary(r)).toEqual([
    "185 corrections at raw 560..3504, up to 71 counts.",
    "Steepest interval 2.06x at raw 1360..1376, shallowest 0.50x at raw 752..768.",
    "25-count windows over raw 544..3520: 0.61x to 1.88x of nominal.",
  ]);
});

test("the identity has nothing to grade", () => {
  const r = report(IDENTITY);
  expect([r.nonzero, r.span, r.grade, r.windows]).toEqual([0, undefined, undefined, undefined]);
  expect(summary(r)).toEqual(["No corrections: every knot is zero."]);
});

test("grade thresholds", () => {
  expect(gradeOf(0.5, 2.0)).toBe("A");
  expect(gradeOf(0.49, 2.0)).toBe("B");
  expect(gradeOf(0.5, 4.0)).toBe("B");
  expect(gradeOf(0.24, 1.0)).toBe("C");
  expect(gradeOf(1.0, 4.01)).toBe("C");
  expect(gradeRule()).toContain("0.5x..2x");
  expect(gradeRule()).toContain("0.25x..4x");
});

test("a coarse SG90-class step, one 6x interval, is suspect", () => {
  const knots = [...IDENTITY];
  knots[100] = 80;
  [75, 60, 45, 30, 15].forEach((c, i) => {
    knots[101 + i] = c;
  });
  const r = report(knots);
  expect(r.steepest?.raw).toBe(1584);
  expect(r.grade).toBe("C");
});

test("every state reads in words and says what the kernel applies", () => {
  expect(stateWords(STATE.IDENTITY)).toMatch(/^No table/);
  expect(stateWords(STATE.LOADING)).toMatch(/^Loading/);
  expect(stateWords(STATE.LIVE)).toMatch(/^Live/);
  expect(stateWords(STATE.REJECT_TORQUE)).toContain("torque was on");
  expect(stateWords(STATE.REJECT_ENDS)).toContain("stop");
  expect(stateWords(STATE.REJECT_SHAPE)).toContain("16x");
  expect(stateWords(9)).toContain("Unknown table state 9");
});
