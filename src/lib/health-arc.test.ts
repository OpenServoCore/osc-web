import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  drawnSpan,
  frame,
  healthArc,
  markAt,
  MIN_PX,
  paneOf,
  phiOf,
  point,
  R,
  shadeOf,
  spanOf,
  summary,
  tableRows,
  type Arc,
} from "./health-arc";
import { REPORT_FILES, type ReportFile, type RunDocs } from "./report";
import type { RunStep } from "./run-folder";

const STEPS: RunStep[] = ["table", "final"].map((name) => ({ name, state: "accepted", why: null }));

/** A synthetic run: identity table, raw 100 to 3700 over 180 deg, so 20 counts a degree. */
function synthetic(points: number[] = new Array<number>(256).fill(0)): RunDocs {
  const field = (value: number) => ({ value });
  const pages = Array.from({ length: 16 }, (_, p) => points.slice(p * 16, p * 16 + 16));
  return new Map<ReportFile, unknown>([
    [
      "final/set.json",
      {
        fields: {
          raw_min: field(100),
          raw_max: field(3700),
          angle_min_cdeg: field(0),
          angle_max_cdeg: field(18000),
          gear_ratio_centi: field(30000),
        },
        wide_codes: { slots: [0, 0, 0, 0, 0, 0, 0, 88, 0, 0, 0, 0, 0, 0, 0, 0] },
      },
    ],
    ["final/inputs/pos_lut.json", { points_by_page: pages }],
    [
      "results/table.json",
      {
        holes: {
          pot: {
            holes: [{ from_counts: 1000, to_counts: 1001, counts: 1, deg: 0.05, cycles: 1 }],
            m: [{ pass: 1, counts_per_cycle: 3.6 }],
            s: 1.5,
            line: 7,
            far_k: 4,
            not_read: [],
          },
          adc: {
            runs: [
              { from_counts: 2048, to_counts: 2058, counts: 11, deg: 0.55, above_carry: 2047 },
              { from_counts: 1280, to_counts: 1281, counts: 2, deg: 0.1, above_carry: 1279 },
              { from_counts: 1500, to_counts: 1502, counts: 3, deg: 0.15, above_carry: null },
            ],
            crossed: { from_counts: 150, to_counts: 3650 },
            edge_margin_counts: 15,
          },
        },
      },
    ],
  ]);
}

function arcOf(docs: RunDocs): Arc {
  const card = healthArc(docs, STEPS);
  if ("why" in card) throw new Error(card.why);
  return card.data;
}

const RUN = new URL(
  "../../../open-servo-core/measure/testdata/run/00000000ffffffff76e5bc220ef6abcd/20261127T130203Z/",
  import.meta.url,
);

function fixture(): RunDocs {
  const docs: RunDocs = new Map();
  for (const file of REPORT_FILES) {
    try {
      docs.set(file, JSON.parse(readFileSync(new URL(file, RUN), "utf8")));
    } catch {
      // Not every report file is in the recorded run.
    }
  }
  return docs;
}

describe("the arc's geometry", () => {
  it("puts the stops at 90 -/+ S/2, the CW stop on the right", () => {
    for (const s of [90, 187, 270]) {
      expect(phiOf(0, s)).toBeCloseTo(90 - s / 2, 12);
      expect(phiOf(s, s)).toBeCloseTo(90 + s / 2, 12);
    }
    const cw = point(R, phiOf(0, 180));
    const ccw = point(R, phiOf(180, 180));
    const top = point(R, phiOf(90, 180));
    expect(cw.x).toBeCloseTo(R, 9);
    expect(cw.y).toBeCloseTo(0, 9);
    expect(ccw.x).toBeCloseTo(-R, 9);
    expect(top.x).toBeCloseTo(0, 9);
    expect(top.y).toBeCloseTo(-R, 9);
  });

  it("maps raw counts to horn degrees from the CW stop through the table and angle map", () => {
    const arc = arcOf(synthetic());
    expect(arc.travelDeg).toBe(180);
    expect(arc.avgCountsPerDeg).toBe(20);
    const hole = arc.pot[0];
    expect(hole?.fromDeg).toBeCloseTo(45, 9);
    expect(hole?.toDeg).toBeCloseTo(45.05, 9);
  });

  it("takes the CW stop at the lower angle when the counts rise clockwise", () => {
    const docs = synthetic();
    const set = docs.get("final/set.json") as { fields: Record<string, { value: number }> };
    set.fields.angle_min_cdeg = { value: 18000 };
    set.fields.angle_max_cdeg = { value: 0 };
    const arc = arcOf(docs);
    expect(arc.pot[0]?.fromDeg).toBeCloseTo(134.95, 9);
    expect(arc.pot[0]?.toDeg).toBeCloseTo(135, 9);
  });

  it("draws a 1-count hole 2 px wide about its true middle", () => {
    const arc = arcOf(synthetic());
    const hole = arc.pot[0];
    if (hole === undefined) throw new Error("no hole");
    const [a, b] = spanOf(hole);
    const mid = (0.85 + 1.07) / 2;
    expect((((b - a) * Math.PI) / 180) * mid * R).toBeCloseTo(MIN_PX, 9);
    expect((a + b) / 2).toBeCloseTo((hole.fromDeg + hole.toDeg) / 2, 12);
    expect(drawnSpan(10, 20, R)).toEqual([10, 20]);
  });

  it("frames the arc and its labels, wider once the travel passes the sides", () => {
    const short = frame(90);
    const half = frame(180);
    const most = frame(300);
    expect(short.w).toBeLessThan(half.w);
    expect(most.h).toBeGreaterThan(half.h);
    expect(half.x).toBeLessThan(-1.26 * R);
    expect(half.x + half.w).toBeGreaterThan(1.26 * R);
  });

  it("follows a 2 px hole within 8 px over the band, and the band elsewhere", () => {
    const arc = arcOf(synthetic());
    const on = point(R, phiOf(45.025, 180));
    expect(markAt(arc, on.x, on.y, 8)?.kind).toBe("pot");
    const near = point(R, phiOf(45.025 + ((6 / R) * 180) / Math.PI, 180));
    expect(markAt(arc, near.x, near.y, 8)?.kind).toBe("pot");
    const far = point(R, phiOf(60, 180));
    expect(markAt(arc, far.x, far.y, 8)?.kind).toBe("good");
    const outside = point(2 * R, phiOf(60, 180));
    expect(markAt(arc, outside.x, outside.y, 8)).toBeUndefined();
  });
});

describe("the arc's encodings", () => {
  it("shades 0.5x, 1x and 2x the average counts a degree at -1, 0 and +1, clamped beyond", () => {
    expect(shadeOf(0.5)).toBe(-1);
    expect(shadeOf(1)).toBe(0);
    expect(shadeOf(2)).toBe(1);
    expect(shadeOf(0.25)).toBe(-1);
    expect(shadeOf(4)).toBe(1);
    expect(shadeOf(Math.SQRT2)).toBeCloseTo(0.5, 12);
  });

  it("reads the table's local slope as counts a degree over the average", () => {
    const identity = arcOf(synthetic());
    expect(identity.good.every((g) => Math.abs(g.q - 1) < 1e-12)).toBe(true);
    // Corrections falling 8 a point halve the gain: twice the average counts a degree.
    const points = Array.from({ length: 256 }, (_, k) => -8 * Math.min(Math.max(k - 100, 0), 40));
    const arc = arcOf(synthetic(points));
    const g = arc.good.find((m) => m.fromRaw === 120 * 16);
    expect(g?.gain).toBeCloseTo(0.5, 12);
    expect(g?.q).toBeCloseTo(2, 12);
    expect(g?.countsPerDeg).toBeCloseTo(40, 9);
  });

  it("draws runs above a carry as wide codes, solid where a slot is stored, and leaves the rest to the pot", () => {
    const arc = arcOf(synthetic());
    expect(arc.adc.map((m) => [m.carry, m.slot])).toEqual([
      [1279, 0],
      [2047, 88],
    ]);
    expect(arc.offCarry).toEqual([expect.objectContaining({ fromRaw: 1500, toRaw: 1502 })]);
    const [bare, stored] = arc.adc;
    if (bare === undefined || stored === undefined) throw new Error("no wide codes");
    expect(paneOf(stored, arc).says).toContain("The stored slot");
    expect(paneOf(bare, arc).says).toContain("No stored slot");
  });

  it("marks what no slow pass crossed and where the passes turn as not judged", () => {
    const arc = arcOf(synthetic());
    expect(arc.unjudged.map((u) => [u.fromRaw, u.toRaw, u.why])).toEqual([
      [100, 135, "uncrossed"],
      [135, 150, "turn"],
      [3650, 3665, "turn"],
      [3665, 3700, "uncrossed"],
    ]);
  });

  it("summarizes the marks for a screen reader", () => {
    expect(summary(arcOf(synthetic()))).toBe(
      "Position sensor over 180.0 degrees: 1 position hole, the longest 1 count (0.05 degrees) from 45.0 to 45.1 degrees; 2 ADC wide codes, the widest 11 codes at 97.4 degrees; 1.00 to 1.00 times the average resolution across 90 % of the judged travel.",
    );
  });
});

describe("the recorded run's arc", () => {
  const arc = arcOf(fixture());

  it("spans the identified travel with the pot hole at the CW stop", () => {
    expect(arc.travelDeg).toBe(187);
    expect(arc.pot).toHaveLength(1);
    const hole = arc.pot[0];
    expect(hole?.fromRaw).toBeCloseTo(6.751, 3);
    expect(hole?.toRaw).toBeCloseTo(118.805, 3);
    expect(hole?.deg).toBeCloseTo(5.6255, 4);
    expect(hole?.fromDeg).toBeCloseTo(0.038, 3);
    expect(hole?.toDeg).toBeCloseTo(5.654, 3);
  });

  it("puts its 10 wide codes at the carries, the widest 2048..2058 above 2047", () => {
    expect(arc.adc).toHaveLength(10);
    expect(arc.adc.every((m) => m.fromRaw === m.carry + 1)).toBe(true);
    expect(arc.widestAdc).toMatchObject({ fromRaw: 2048, toRaw: 2058, counts: 11, carry: 2047 });
    expect(arc.adc.filter((m) => m.slot !== 0).map((m) => m.carry)).toEqual([
      511, 1023, 2047, 2559,
    ]);
  });

  it("lists every mark and a resolution row every 10 deg", () => {
    const rows = tableRows(arc);
    const kinds = (k: string) => rows.filter((r) => r.kind.startsWith(k)).length;
    expect(kinds("position hole")).toBe(1);
    expect(kinds("ADC wide code")).toBe(10);
    expect(kinds("no wide code judged")).toBe(4);
    expect(kinds("resolution")).toBe(18);
    expect(summary(arc)).toBe(
      "Position sensor over 187.0 degrees: 1 position hole, the longest 112.1 counts (5.63 degrees) from 0.0 to 5.7 degrees; 10 ADC wide codes, the widest 11 codes at 101.2 degrees; 0.73 to 1.31 times the average resolution across 90 % of the judged travel.",
    );
  });
});
