import { expect, test } from "vitest";
import image from "../../../open-servo-core/ident/testdata/lut/pot-lut-mg90-a-grid.json";
import {
  counts,
  errorSeries,
  gradeOf,
  gradeRule,
  headline,
  hoverWords,
  interpQ4,
  isIdentity,
  pointsWords,
  q4,
  q4ToCounts,
  report,
  STATE,
  stateWords,
  WINDOW,
} from "./pot-lut";
import type { Calibration } from "./units";

const mg90a: number[] = image.knots;
const IDENTITY: number[] = Array.from({ length: 256 }, () => 0);
/** The bench MG90's angle map: stops 232..3849 read 0..183.06 deg. */
const MG90: Calibration = {
  rawMin: 232,
  rawMax: 3849,
  angleMinCdeg: 0,
  angleMaxCdeg: 18306,
  gearRatioCenti: 30805,
};

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
  expect(r.band).toEqual([544, 3520]);
  expect(r.windows?.counts).toBe(WINDOW);
  expect(r.windows?.min).toBeCloseTo(0.6125, 9);
  expect(r.windows?.max).toBeCloseTo(1.8825, 9);
  expect(r.grade).toBe("A");
  expect(pointsWords(r, MG90)).toBe("185 calibration points between 16.6 deg and 165.6 deg.");
  expect(pointsWords(r, undefined)).toBe(
    "185 calibration points between raw 560 counts and raw 3504 counts.",
  );
});

test("the mg90-a error over the MG90 map: 71 counts is 3.6 deg, 2.0% of travel", () => {
  const s = errorSeries(mg90a, MG90);
  expect(s.unit).toBe("deg");
  expect(s.x).toHaveLength(3849 - 232 + 1);
  expect(s.x[0]).toBe(0);
  expect(s.x.at(-1)).toBeCloseTo(183.06, 9);
  const degPerCount = 183.06 / 3617;
  expect(s.maxAbs).toBeCloseTo(71 * degPerCount, 9);
  expect(s.maxAbs).toBeCloseTo(3.5934, 3);
  expect(s.maxAbs * s.pctPerUnit).toBeCloseTo((71 / 3617) * 100, 9);
  expect(s.maxAbs * s.pctPerUnit).toBeCloseTo(1.963, 3);
  expect(s.band).toEqual([(544 - 232) * degPerCount, (3520 - 232) * degPerCount]);
  // Raw 560 carries +4 counts: the sensor reads 0.2 deg low there.
  const i = 560 - 232;
  expect(s.x[i]).toBeCloseTo(328 * degPerCount, 9);
  expect(s.y[i]).toBeCloseTo(-4 * degPerCount, 9);
  expect(headline(s)).toBe(
    "The sensor reads up to 3.6 deg (2.0% of travel) off; this table corrects it.",
  );
  expect(hoverWords(s, i)).toBe("16.6 deg: reads low by 0.2 deg (0.1% of travel)");
  expect(hoverWords(s, 0)).toBe("0.0 deg: on target");
  expect(hoverWords(s, s.x.length)).toBe("");
});

test("without an angle map the error stays in counts, percent of the 12-bit range", () => {
  const s = errorSeries(mg90a, undefined);
  expect(s.unit).toBe("counts");
  expect(s.x).toHaveLength(4096);
  expect([s.x[0], s.x.at(-1)]).toEqual([0, 4095]);
  expect(s.maxAbs).toBe(71);
  expect(s.maxAbs * s.pctPerUnit).toBeCloseTo((71 / 4096) * 100, 9);
  expect(s.band).toEqual([544, 3520]);
  expect(s.y[560]).toBe(-4);
  expect(headline(s)).toBe(
    "The sensor reads up to 71 counts (1.7% of its range) off; this table corrects it.",
  );
  expect(hoverWords(s, 560)).toBe("raw 560 counts: reads low by 4 counts (0.1% of its range)");
});

test("a table that adds counts at a raw reading means the sensor reads low there", () => {
  const knots = [...IDENTITY];
  knots[100] = 10;
  knots[101] = -10;
  const s = errorSeries(knots, undefined);
  // The servo reports raw 1600 as 1610: the true position is 10 counts above the reading.
  expect(counts(knots, 1600)).toBe(1610);
  expect(s.y[1600]).toBe(-10);
  expect(hoverWords(s, 1600)).toMatch(/reads low by 10 counts/);
  // And raw 1616 as 1606: the sensor reads 10 counts high.
  expect(counts(knots, 1616)).toBe(1606);
  expect(s.y[1616]).toBe(10);
  expect(hoverWords(s, 1616)).toMatch(/reads high by 10 counts/);
});

test("a falling angle map keeps x ascending and flips the error with it", () => {
  const falling: Calibration = { ...MG90, angleMinCdeg: 18306, angleMaxCdeg: 0 };
  const s = errorSeries(mg90a, falling);
  expect(s.x[0]).toBe(0);
  expect(s.x.at(-1)).toBeCloseTo(183.06, 9);
  expect(s.maxAbs).toBeCloseTo(3.5934, 3);
  // Raw 560 now sits at 183.06 - 16.6 deg; +4 counts is a lower angle, so the sensor reads high.
  const i = 3849 - 560;
  expect(s.x[i]).toBeCloseTo(183.06 - (328 * 183.06) / 3617, 9);
  expect(s.y[i]).toBeCloseTo((4 * 183.06) / 3617, 9);
  expect(hoverWords(s, i)).toBe("166.5 deg: reads high by 0.2 deg (0.1% of travel)");
});

test("the identity has nothing to grade", () => {
  const r = report(IDENTITY);
  expect([r.nonzero, r.span, r.grade, r.windows]).toEqual([0, undefined, undefined, undefined]);
  expect(pointsWords(r, MG90)).toBe("No calibration points: the table is all zeros.");
  const s = errorSeries(IDENTITY, MG90);
  expect([s.maxAbs, s.band]).toEqual([0, undefined]);
  expect(s.y.every((e) => e === 0)).toBe(true);
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
  expect(r.windows?.max).toBeGreaterThan(4);
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
