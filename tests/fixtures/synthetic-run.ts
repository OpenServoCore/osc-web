import { gzipSync } from "node:zlib";

/** The bench mg90-d's uid, as osc-ident names its run folders. */
export const RUN_UID = "00000000ffffffff76e5bc220ef6abcd";
export const RUN_UTC = "20261127T040624Z";

export interface RunFileBytes {
  path: string;
  bytes: Uint8Array<ArrayBuffer>;
}

const START = 1795752384.538729;

// serde_json's pretty form with the newline osc-ident adds.
const json = (value: unknown): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);

const entry = (at: number, files?: string[]) => ({
  state: "accepted",
  why: null,
  started: START + at,
  ended: START + at + 1,
  ...(files === undefined ? {} : { files }),
});

/** A whole `osc-ident run`'s manifest, every entry accepted. */
export function runManifest(uid = RUN_UID): Record<string, unknown> {
  const steps = ["rest", "probe", "stops", "table", "window", "spins"];
  return {
    tool: "osc-ident 0.1.0",
    servo_uid: uid,
    image: "production",
    capability_flags: 1,
    steps: Object.fromEntries(steps.map((s, i) => [s, entry(i)])),
    gather: entry(6, ["inputs/measured.json", "inputs/resolved.json"]),
    tune: entry(7, ["tune/tune.json", "tune/set.json"]),
    cruise: entry(8, ["results/cruise.json"]),
    final: { ...entry(9, ["final/set.json", "final/results/verify.json"]), set: "2053b6de" },
  };
}

/**
 * A small run folder in the shape osc-ident writes it: `run.json`, step
 * results, the gather's `resolved.json`, a gzipped capture with its meta and
 * the final set. Paths are from the run folder.
 */
export function syntheticRun(manifest: Record<string, unknown> = runManifest()): RunFileBytes[] {
  const csv = "tick,pos,current,duty_counts\n0,2041,1206,0\n1,2042,1205,0\n";
  return [
    { path: "run.json", bytes: json(manifest) },
    {
      path: "results/rest.json",
      bytes: json({
        estimates: {
          pot_noise_counts: { value: 1.21, sd: 0.04, n: 4096, unit: "counts", source: "rest rows" },
        },
        checks: [{ name: "horn at rest", value: 0, bound: 3, verdict: "reported" }],
      }),
    },
    {
      path: "results/stops.json",
      bytes: json({
        estimates: {
          r_seated_25c_ohm: { value: 4.27, sd: 0.06, n: 18, unit: "ohm", source: "seated bursts" },
        },
        checks: [],
      }),
    },
    {
      path: "inputs/resolved.json",
      bytes: json({
        profile: { key: "vorpal-mg90", revision: 3 },
        policy: { key: "default" },
        fields: [],
      }),
    },
    { path: "captures/rest/02-raw.csv.gz", bytes: new Uint8Array(gzipSync(csv)) },
    { path: "captures/rest/02-raw.meta.json", bytes: json({ plan: "rest", rows: 2 }) },
    { path: "final/set.json", bytes: json({ pair: "vorpal-mg90__osc-dev-v006", fields: {} }) },
  ];
}
