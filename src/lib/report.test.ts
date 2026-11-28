import { initSync, migrate, resolvePreview } from "@openservocore/client";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NO_HEAT_MODEL } from "./profile-form";
import {
  freeSpeed,
  moveTrace,
  notReached,
  parseCsv,
  readRows,
  scoreCounts,
  short,
  spreadSaid,
  stoppedAt,
  termAt,
  type Term,
} from "./report";
import { centerSaid, heatSaid } from "./report-cards";
import type { RunStep } from "./run-folder";

const RUN = new URL(
  "../../../open-servo-core/measure/testdata/run/00000000ffffffff76e5bc220ef6abcd/20261127T130203Z/",
  import.meta.url,
);

function json(path: string): unknown {
  return JSON.parse(readFileSync(new URL(path, RUN), "utf8"));
}

function bytes(path: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(readFileSync(new URL(path, RUN)));
}

async function gzip(text: string): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe("numbers as osc-ident prints them", () => {
  it("keeps four decimals, or four in exponent form under 0.01", () => {
    expect(short(4.098778322527737)).toBe("4.0988");
    expect(short(0.0011577222303715766)).toBe("1.1577e-3");
    expect(short(0)).toBe("0.0000");
  });

  it("says a spread as +/- sd and n, n alone, or nominal", () => {
    const t: Term = { value: 1, sd: 0.04458048587985423, n: 36, unit: "ohm" };
    expect(spreadSaid(t)).toBe("+/- 0.0446, n 36");
    expect(spreadSaid({ ...t, sd: null })).toBe("n 36");
    expect(spreadSaid({ ...t, sd: null, n: null })).toBe("nominal");
  });
});

describe("free speed from Ke", () => {
  it("equals the run's own cross-check at every stated no-load voltage", () => {
    const ke = termAt(json("inputs/measured.json"), "ke_v_s_per_rad");
    const gear = (json("inputs/nameplate.json") as { gear_ratio: number }).gear_ratio;
    const rows = (
      json("inputs/cross-checks.json") as {
        free_speed: { at_v: number; run: { value: number; sd: number; n: number } }[];
      }
    ).free_speed;
    if (ke === undefined) throw new Error("the run holds no Ke");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const s = freeSpeed(row.at_v, ke, gear);
      expect(s?.value).toBeCloseTo(row.run.value, 9);
      expect(s?.sd).toBeCloseTo(row.run.sd, 9);
      expect(s?.n).toBe(row.run.n);
    }
  });

  it("scales with the volts and refuses a Ke that is not over 0", () => {
    const ke: Term = { value: 1e-3, sd: 1e-5, n: 4, unit: "V s/rad" };
    const at5 = freeSpeed(5, ke, 300);
    expect(at5?.value).toBeCloseTo((5 / 1e-3 / 300) * (180 / Math.PI), 9);
    expect(at5?.sd).toBeCloseTo((at5?.value ?? 0) * 0.01, 9);
    expect(freeSpeed(5, { ...ke, value: 0 }, 300)).toBeUndefined();
  });
});

describe("the capture row reader", () => {
  it("reads a gzipped CSV's columns, an empty cell as null", async () => {
    const rows = await readRows(await gzip("tick,pos,current\n0,1886,\n1,1890,12\n"));
    expect(rows.get("tick")).toEqual([0, 1]);
    expect(rows.get("pos")).toEqual([1886, 1890]);
    expect(rows.get("current")).toEqual([null, 12]);
  });

  it("reads every row of a recorded move", async () => {
    const meta = json("final/captures/verify/07-raw.meta.json") as { rows: number };
    const rows = await readRows(bytes("final/captures/verify/07-raw.csv.gz"));
    expect(rows.get("tick")?.length).toBe(meta.rows);
    expect(rows.get("pos")?.every((p) => p !== null)).toBe(true);
  });
});

describe("where the run stopped", () => {
  const step = (name: string, state: string, why: string | null = null): RunStep => ({
    name,
    state,
    why,
  });
  const refused = [
    step("rest", "accepted"),
    step("probe", "refused", "the bridge drives one sign only"),
    step("gather", "not run", "not every step was accepted"),
    step("final", "not run", "not every step was accepted"),
  ];

  it("is the first entry that ended other than accepted", () => {
    expect(stoppedAt(refused)?.name).toBe("probe");
    expect(stoppedAt([step("rest", "accepted"), step("gather", "not run")])).toBeUndefined();
  });

  it("names the stopping step on its own card and the first unreached one on later cards", () => {
    expect(notReached(refused, ["rest"])).toBeUndefined();
    expect(notReached(refused, ["probe"])).toBe("The run stopped at the probe.");
    expect(notReached(refused, ["table", "final"])).toBe("The run did not reach the table.");
    expect(notReached(refused, ["final"])).toBe("The run did not reach the final check.");
  });
});

describe("a move's rows", () => {
  it("reads a wide code as the middle of its band, then the table", () => {
    const points = new Array<number>(256).fill(0);
    const slots = new Array<number>(16).fill(0);
    slots[7] = 88;
    expect(scoreCounts(points, slots, 2047)).toBe(2047 + 88 / 16);
    expect(scoreCounts(points, slots, 2046)).toBe(2046);
    points[128] = 16;
    expect(scoreCounts(points, slots, 2056)).toBe(2056 + 8);
  });

  it("gives degrees through the angle map and current only where a window was read", () => {
    const rows = parseCsv("tick,pos,current_raw,window_valid\n100,100,1212,1\n120,200,1323,0\n");
    const trace = moveTrace(rows, {
      cal: { rawMin: 0, rawMax: 1000, angleMinCdeg: 0, angleMaxCdeg: 10000, gearRatioCenti: 0 },
      points: new Array<number>(256).fill(0),
      slots: new Array<number>(16).fill(0),
      currentZeroCounts: 1212,
      countsPerA: 1000,
      tickHz: 20000,
      fromCounts: 100,
      goalCounts: 300,
    });
    expect(trace.t).toEqual([0, 0.001]);
    expect(trace.deg).toEqual([10, 20]);
    expect(trace.goal).toEqual([10, 30]);
    expect(trace.ma).toEqual([0, null]);
  });
});

describe("the heat line", () => {
  initSync({
    module: readFileSync(
      new URL("../../../open-servo-core/client/web/pkg/osc_client_web_bg.wasm", import.meta.url),
    ),
  });
  const record = (name: string): unknown =>
    JSON.parse(
      readFileSync(
        new URL(`../../../open-servo-core/measure/testdata/mg90-d/${name}`, import.meta.url),
        "utf8",
      ),
    );

  it("reads the profile's four lines where the resolve wrote them", () => {
    const m = migrate(record("profile.json"), record("policy-of-record.json"));
    const resolved = resolvePreview(m.profile, m.policy, 4.18).report;
    expect(heatSaid(resolved, undefined)).toBe(
      `Heat model from the profile vorpal-mg90 rev ${String(m.profile.revision)}, not identified: fast 2.38 s 20.4 C/W, slow 128.9 s 76.8 C/W`,
    );
  });

  it("reads a version 0 run's thermal.json, and says the run's refusal with neither", () => {
    expect(heatSaid(json("inputs/resolved.json"), json("inputs/thermal.json"))).toBe(
      "Heat model from inputs/thermal.json beside the version 0 nameplate, not identified: fast 2.38 s 20.4 C/W, slow 128.9 s 76.8 C/W",
    );
    expect(heatSaid(json("inputs/resolved.json"), undefined)).toBe(NO_HEAT_MODEL);
  });
});

describe("where the set puts 0 deg", () => {
  // The record's contacts 82 / 3792 at 20.1266 counts a deg, a 180 deg window.
  it("says the center of travel, a tuned offset, and a clamp with what was asked", () => {
    const set = (center: Record<string, unknown>) => ({ center });
    expect(
      centerSaid(set({ counts: 1937, raw: 1940.25, offset_deg: 0, asked_offset_deg: null })),
    ).toBe("0 deg at the center of travel, 1937.0 counts, raw 1940.3");
    expect(
      centerSaid(set({ counts: 1957.13, raw: 1960, offset_deg: 1, asked_offset_deg: 1 })),
    ).toBe("0 deg at +1.00 deg from the center of travel, 1957.1 counts, raw 1960.0");
    expect(
      centerSaid(
        set({ counts: 1960.5, raw: 1963, offset_deg: 1.17, asked_offset_deg: 5, clamped: true }),
      ),
    ).toBe(
      "0 deg at +1.17 deg from the center of travel, clamped from the policy's +5.00 deg, the furthest the soft window fits, at 1960.5 counts, raw 1963.0",
    );
  });

  it("says the recorded run's center, the middle of its two first contacts", () => {
    expect(centerSaid(json("final/set.json"))).toBe(
      "0 deg at the center of travel, 1926.8 counts, raw 1935.8",
    );
  });

  it("says nothing for a set written before it held a center", () => {
    const before = json("final/set.json") as Record<string, unknown>;
    delete before.center;
    expect(centerSaid(before)).toBeUndefined();
  });
});
