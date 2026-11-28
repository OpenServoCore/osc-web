import type { RunOutcome } from "@openservocore/client-ident";
import { expect, test } from "vitest";
import { RUN_UID, RUN_UTC, syntheticRun } from "../../tests/fixtures/synthetic-run";
import { handOver, outcomeRun, runArgs, storeOutcome, type Lender } from "./ident-run";
import type { ServoProfile, Stored, TuningPolicy } from "./library";
import { listTree, readFile } from "./opfs";
import { memoryOpfs } from "./opfs-fake";
import { DEFAULT_POLICY } from "./policy-form";
import { listRuns } from "./run-folder";

const DEVICE = { productName: "osc-adapter" } as USBDevice;

function lender(opts: { release?: Error; reclaim?: Error } = {}): Lender & { said: string[] } {
  const said: string[] = [];
  return {
    said,
    release() {
      said.push("release");
      return opts.release === undefined ? Promise.resolve(DEVICE) : Promise.reject(opts.release);
    },
    reclaim() {
      said.push("reclaim");
      return opts.reclaim === undefined
        ? Promise.resolve("b3000000")
        : Promise.reject(opts.reclaim);
    },
  };
}

test("the run gets the lent device, and the bus is taken back after it", async () => {
  const c = lender();
  const got = await handOver(c, (device) => {
    c.said.push(`run on ${String(device?.productName)}`);
    return Promise.resolve(7);
  });
  expect(got).toBe(7);
  expect(c.said).toEqual(["release", "run on osc-adapter", "reclaim"]);
});

test("a run that throws still gives the bus back, then its own failure is thrown", async () => {
  const c = lender();
  await expect(handOver(c, () => Promise.reject(new Error("wasm panicked")))).rejects.toThrow(
    "wasm panicked",
  );
  expect(c.said).toEqual(["release", "reclaim"]);
});

test("a release that fails part way is still reclaimed", async () => {
  const c = lender({ release: new Error("closing the device failed") });
  let ran = false;
  await expect(
    handOver(c, () => {
      ran = true;
      return Promise.resolve();
    }),
  ).rejects.toThrow("closing the device failed");
  expect(ran).toBe(false);
  expect(c.said).toEqual(["release", "reclaim"]);
});

test("a reclaim that fails is thrown, after the run's own failure if it had one", async () => {
  const gone = new Error("The device was disconnected.");
  await expect(handOver(lender({ reclaim: gone }), () => Promise.resolve(1))).rejects.toBe(gone);
  await expect(
    handOver(lender({ reclaim: gone }), () => Promise.reject(new Error("first"))),
  ).rejects.toThrow("first");
});

const bytes = (text: string) => new TextEncoder().encode(text);

const PROFILE = {
  value: { schema: "osc.servo-profile/1", key: "vorpal-mg90", revision: 3 },
  bytes: bytes('{"key":"vorpal-mg90"}\n'),
  sha256: "",
} as unknown as Stored<ServoProfile>;

test("the run takes the profile and policy at their library paths, with their stored bytes", () => {
  const policy = {
    value: { ...DEFAULT_POLICY, key: "mg90-d-record", revision: 2 },
    bytes: bytes('{"key":"mg90-d-record"}\n'),
    sha256: "",
  } as Stored<TuningPolicy>;
  expect(runArgs(1, PROFILE, policy)).toEqual({
    id: 1,
    nameplate: "profiles/vorpal-mg90.json",
    policy: "policies/mg90-d-record.json",
    files: [
      { path: "profiles/vorpal-mg90.json", bytes: PROFILE.bytes },
      { path: "policies/mg90-d-record.json", bytes: policy.bytes },
    ],
  });
});

test("Default is given as default.json, its key the file's name as on the command line", () => {
  const args = runArgs(4, PROFILE, null);
  expect(args.policy).toBe("policies/default.json");
  const given = args.files.find((f) => f.path === args.policy);
  expect(JSON.parse(new TextDecoder().decode(given?.bytes))).toEqual(DEFAULT_POLICY);
});

function outcome(files: RunOutcome["files"], root?: string): RunOutcome {
  return { root, files, lines: [], accepted: false };
}

test("the run's folder goes into storage at its <uid>/<UTC>/ path, byte for byte", async () => {
  const at = `${RUN_UID}/${RUN_UTC}`;
  const run = syntheticRun();
  const root = memoryOpfs();
  const stored = await storeOutcome(
    root,
    outcome(
      run.map((f) => ({ path: `${at}/${f.path}`, bytes: f.bytes })),
      at,
    ),
  );
  expect(stored?.identity).toMatchObject({ uid: RUN_UID, utc: RUN_UTC });
  expect((await listTree(root, at)).map((f) => f.path)).toEqual(run.map((f) => f.path).sort());
  for (const f of run) expect(await readFile(root, `${at}/${f.path}`)).toEqual(f.bytes);
  expect((await listRuns(root)).map((r) => `${r.identity.uid}/${r.identity.utc}`)).toEqual([at]);
});

test("a run refused before it named a folder stores nothing", async () => {
  const root = memoryOpfs();
  expect(outcomeRun(outcome([]))).toBeUndefined();
  expect(await storeOutcome(root, outcome([]))).toBeUndefined();
  expect(await listRuns(root)).toEqual([]);
});
