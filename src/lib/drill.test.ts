import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  acceptedTry,
  captureEntries,
  captureSeries,
  cellText,
  checkRows,
  csvPreview,
  estimateRows,
  histogram,
  keyLines,
  level,
  meanBand,
  planText,
  pointsBy,
  scatter,
  tries,
  trimmedText,
} from "./drill";
import { list, parseCsv } from "./report";

const RUN = new URL(
  "../../../open-servo-core/measure/testdata/run/00000000ffffffff76e5bc220ef6abcd/20261127T130203Z/",
  import.meta.url,
);

function json(path: string): unknown {
  return JSON.parse(readFileSync(new URL(path, RUN), "utf8"));
}

function names(dir: string): string[] {
  return readdirSync(new URL(dir, RUN)).sort();
}

describe("a step's estimates and checks", () => {
  it("gives each estimate its value, spread, n and unit as the report shows them", () => {
    const rows = estimateRows(json("results/stops.json"));
    expect(rows.find((r) => r.name === "r_seated_ohm")).toMatchObject({
      value: "4.0988",
      sd: "± 0.0446",
      n: "36",
      unit: "Ω",
    });
    const ke = estimateRows(json("results/spins.json")).find((r) => r.name === "ke_v_s_per_rad");
    expect(ke).toMatchObject({ value: "1.1577e-3", sd: "± 7.5884e-6", n: "11", unit: "V s/rad" });
  });

  it("leaves the spread blank where the step wrote none and says so where the step wrote null", () => {
    const rows = estimateRows(json("results/rest.json"));
    expect(rows.find((r) => r.name === "vdd_v")).toMatchObject({ sd: "", n: "1" });
    expect(rows.find((r) => r.name === "vdd_frame_ripple_mv_pp")?.value).toBe("none written");
    expect(estimateRows(json("results/table.json"))).toEqual([
      expect.objectContaining({
        name: "pot_step4_counts",
        value: "5.0000",
        sd: "",
        n: "30",
        unit: "raw counts",
      }),
    ]);
  });

  it("gives no rows for a step that writes no estimates", () => {
    expect(estimateRows(json("final/results/verify.json"))).toEqual([]);
  });

  it("keeps the checks word for word", () => {
    const [first] = checkRows(json("results/stops.json"));
    expect(first).toEqual({
      name: "each stop's seats agree",
      value: "low 6, 6, 6 (0 apart); high 3737, 3737, 3738 (1 apart)",
      bound: "3 seats each, within 10 counts",
      verdict: "pass",
    });
  });
});

describe("values for a cell", () => {
  it("prints integers whole, other numbers four places, lists joined", () => {
    expect(cellText(36)).toBe("36");
    expect(cellText(4.098778322527737)).toBe("4.0988");
    expect(cellText([1, 0.5])).toBe("1, 0.5000");
    expect(cellText(null)).toBe("");
    expect(cellText(false)).toBe("false");
  });

  it("dots the keys of nested objects", () => {
    expect(keyLines({ a: 1, b: { c: "x", d: [2, 3] } })).toEqual([
      { key: "a", value: "1" },
      { key: "b.c", value: "x" },
      { key: "b.d", value: "2, 3" },
    ]);
  });
});

describe("a step's captures", () => {
  it("pairs each meta with its rows file and marks the ones trimmed out", () => {
    const entries = captureEntries("captures/probe", names("captures/probe"));
    expect(entries.map((e) => e.name).slice(0, 3)).toEqual(["01-raw", "02-raw", "03-raw"]);
    expect(entries.find((e) => e.name === "01-raw")).toMatchObject({
      rows: "captures/probe/01-raw.csv.gz",
      kept: true,
    });
    const burst0 = entries.find((e) => e.name === "burst-0");
    expect(burst0).toMatchObject({ rows: "captures/probe/burst-0.csv", kept: true });
    const dropped = entries.find((e) => e.name === "02-raw");
    expect(dropped?.kept).toBe(false);
    expect(dropped && trimmedText(dropped)).toBe(
      "Trimmed: the run folder does not hold captures/probe/02-raw.csv.gz; its 02-raw.meta.json is.",
    );
    const burst1 = entries.find((e) => e.name === "burst-1");
    expect(burst1).toMatchObject({ rows: "captures/probe/burst-1.csv", kept: false });
    expect(entries.filter((e) => !e.kept)).toHaveLength(30);
  });

  it("lists a rows file with no meta beside it", () => {
    const polls = captureEntries("captures/stops", names("captures/stops")).find(
      (e) => e.name === "polls",
    );
    expect(polls).toEqual({
      name: "polls",
      meta: undefined,
      rows: "captures/stops/polls.csv",
      kept: true,
    });
  });

  it("names what a capture was from its plan", () => {
    expect(planText(json("captures/table/02-raw.meta.json"))).toBe(
      "rung 1 (pass 1 down, free), drive + coast, 2000 rows",
    );
    expect(planText(json("captures/probe/burst-0.meta.json"))).toBe("burst 0, 960 samples");
    expect(planText(json("captures/cruise/02-raw.meta.json"))).toBe("cruise leg 1, 24000 rows");
  });

  it("previews the first rows as text and counts them all", () => {
    const p = csvPreview("t_s,kind\n1.5,start\n2,approach\n3,seat\n", 2);
    expect(p).toEqual({
      header: ["t_s", "kind"],
      rows: [
        ["1.5", "start"],
        ["2", "approach"],
      ],
      total: 3,
    });
  });

  it("draws a column against time from the ticks, or the first column", () => {
    const cols = parseCsv("seg,tick,pos\n0,10,5\n0,11,\n0,12,7\n");
    expect(captureSeries(cols, "pos", 20000)).toEqual({
      x: [0, 1 / 20000, 2 / 20000],
      y: [5, null, 7],
      xLabel: "time, s",
    });
    const burst = parseCsv("k,code\n0,1212\n1,772\n");
    expect(captureSeries(burst, "code", undefined)).toEqual({
      x: [0, 1],
      y: [1212, 772],
      xLabel: "k",
    });
  });

  it("counts each code of a still row", () => {
    expect(histogram([3, 1, 3, null, 2, 3])).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 3 },
    ]);
  });
});

describe("point sets for the drill-in charts", () => {
  it("splits the stops' seated bursts into kept and set aside, as many kept as the estimate's n", () => {
    const bursts = list(json("results/stops.json"), "seated.bursts");
    const [kept, aside] = pointsBy(bursts, (_, i) => i + 1, "r_ohm", "kept");
    expect(kept).toHaveLength(36);
    expect(aside).toHaveLength(12);
    expect(kept[0]).toEqual({ x: 2, y: 4.042139902528631 });
  });

  it("keeps points that share an x apart, each set null off its own points", () => {
    const a = [
      { x: 2, y: 1 },
      { x: 1, y: 3 },
    ];
    const b = [{ x: 2, y: 5 }];
    expect(scatter([a, b])).toEqual([
      [1, 2, 2],
      [3, 1, null],
      [null, null, 5],
    ]);
  });

  it("scales y where the chart draws in another unit", () => {
    const [yes] = pointsBy([{ k: 1, ke: 0.0011, in: true }], "k", "ke", "in", 1e3);
    expect(yes[0]?.y).toBeCloseTo(1.1, 12);
  });

  it("lays a level and a one-sd band across the points", () => {
    const pts = [
      { x: 1, y: 0 },
      { x: 4, y: 0 },
    ];
    expect(level(2, [pts])).toEqual([
      { x: 1, y: 2 },
      { x: 4, y: 2 },
    ]);
    expect(meanBand(2, 0.5, [pts]).hi).toEqual([
      { x: 1, y: 2.5 },
      { x: 4, y: 2.5 },
    ]);
    expect(meanBand(2, null, [pts]).lo).toEqual([]);
  });
});

describe("the tune's tries", () => {
  it("lists the tune's tries then the back-off's, each with its gain and the tool's word", () => {
    const tune = json("tune/tune.json");
    const backOff = json("tune/back-off.json");
    const rows = tries(tune, backOff);
    expect(rows.map((t) => [t.n, t.vKp, t.verdict, t.from])).toEqual([
      [1, "153", "refused", "tune"],
      [2, "123", "refused", "tune"],
      [3, "98", "refused", "tune"],
      [4, "79", "refused", "tune"],
      [5, "63", "refused", "tune"],
      [6, "50", "accepted", "tune"],
      [7, "50", "accepted", "back-off"],
    ]);
    expect(rows[0]?.failedOn).toBe("rest error");
    expect(rows[6]?.after).toBe("the tune's check accepted its try 6");
    expect(acceptedTry(tune, backOff)).toBe(7);
    expect(acceptedTry(tune, undefined)).toBe(6);
  });
});
