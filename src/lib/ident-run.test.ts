import type { RunOutcome } from "@openservocore/client-ident";
import { expect, test } from "vitest";
import { RUN_UID, RUN_UTC, syntheticRun } from "../../tests/fixtures/synthetic-run";
import {
  handOver,
  outcomeRun,
  resumeArgs,
  rewriteOutcome,
  runArgs,
  stopped,
  type Lender,
} from "./ident-run";
import type { ServoProfile, Stored, TuningPolicy } from "./library";
import { listTree, readFile, writeFile } from "./opfs";
import { memoryOpfs } from "./opfs-fake";
import { DEFAULT_POLICY } from "./policy-form";
import { listRuns, locateRun } from "./run-folder";
import { mirrorInto } from "./run-mirror";

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
  const stored = await rewriteOutcome(
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
  expect(await rewriteOutcome(root, outcome([]))).toBeUndefined();
  expect(await listRuns(root)).toEqual([]);
});

const AT = `${RUN_UID}/${RUN_UTC}`;
const bytesOf = (s: string) => new TextEncoder().encode(s);

test("the mirror applies each change as the run tells it, and a move takes the folder whole", async () => {
  const root = memoryOpfs();
  const m = mirrorInto(root);
  await m.onStore({ op: "write", path: `${AT}/captures/probe/01.csv.gz`, bytes: bytesOf("a") });
  await m.onStore({ op: "write", path: `${AT}/run.json`, bytes: bytesOf("{}") });
  await m.onStore({ op: "write", path: `${AT}/run.json`, bytes: bytesOf('{"n": 2}') });
  await m.onStore({
    op: "move",
    from: `${AT}/captures/probe`,
    to: `${AT}/segments/1/captures/probe`,
  });
  expect(m.failure()).toBeUndefined();
  expect((await listTree(root, AT)).map((f) => f.path)).toEqual([
    "run.json",
    "segments/1/captures/probe/01.csv.gz",
  ]);
  expect(await readFile(root, `${AT}/run.json`)).toEqual(bytesOf('{"n": 2}'));
});

test("a change the mirror cannot apply is kept, and the ones after it still go", async () => {
  const root = memoryOpfs();
  const m = mirrorInto(root);
  await m.onStore({ op: "move", from: `${AT}/captures/none`, to: `${AT}/segments/1/none` });
  await m.onStore({ op: "write", path: `${AT}/run.json`, bytes: bytesOf("{}") });
  expect(m.failure()).toBe(
    `${AT}/captures/none to ${AT}/segments/1/none: nothing at ${AT}/captures/none to move`,
  );
  expect(await readFile(root, `${AT}/run.json`)).toEqual(bytesOf("{}"));
});

test("a mirror that failed is written over with the outcome's folder whole", async () => {
  const root = memoryOpfs();
  await writeFile(root, `${AT}/stray.json`, bytesOf("{}"));
  const run = syntheticRun();
  const stored = await rewriteOutcome(
    root,
    outcome(
      run.map((f) => ({ path: `${AT}/${f.path}`, bytes: f.bytes })),
      AT,
    ),
  );
  expect(stored?.identity).toMatchObject({ uid: RUN_UID, utc: RUN_UTC });
  expect((await listTree(root, AT)).map((f) => f.path)).toEqual(run.map((f) => f.path).sort());
});

test("a run that did not get through the final check is offered a resume; a whole one is not", () => {
  const whole = locateRun(syntheticRun().map((f) => ({ path: `${AT}/${f.path}`, bytes: f.bytes })));
  expect(stopped(whole.identity)).toBe(false);
  expect(
    stopped({ ...whole.identity, steps: [{ name: "rest", state: "accepted", why: null }] }),
  ).toBe(true);
  expect(
    stopped({
      ...whole.identity,
      steps: whole.identity.steps.map((s) =>
        s.name === "final" ? { ...s, state: "refused", why: "refused: overshoot" } : s,
      ),
    }),
  ).toBe(true);
});

test("a resume is given the profile and policy run.json records, from the library, and the folder whole", async () => {
  const root = memoryOpfs();
  const doc = {
    servo_uid: RUN_UID,
    given: {
      nameplate: { path: "profiles/vorpal-mg90.json", sha1: "x" },
      policy: { path: "policies/default.json", sha1: "y" },
      tries: 6,
    },
    steps: { rest: { state: "accepted" }, probe: { state: "running" } },
  };
  await writeFile(root, `${AT}/run.json`, bytesOf(JSON.stringify(doc)));
  await writeFile(root, `${AT}/results/rest.json`, bytesOf("{}"));
  await writeFile(root, "profiles/vorpal-mg90.json", bytesOf('{"key": "vorpal-mg90"}'));
  const a = await resumeArgs(root, 3, AT, undefined);
  expect(a).toMatchObject({
    id: 3,
    nameplate: "profiles/vorpal-mg90.json",
    policy: "policies/default.json",
    folder: AT,
  });
  const paths = a.files.map((f) => f.path);
  expect(paths).toEqual([
    "profiles/vorpal-mg90.json",
    "policies/default.json",
    `${AT}/results/rest.json`,
    `${AT}/run.json`,
  ]);
  // The Default policy as a new run is given it.
  const given = runArgs(3, { value: { key: "vorpal-mg90" } } as Stored<ServoProfile>, null);
  expect(a.files[1]?.bytes).toEqual(given.files[1]?.bytes);

  // A folder whose run.json names no files is given the servo's setup now, for the module to refuse.
  await writeFile(root, `${AT}/run.json`, bytesOf(JSON.stringify({ ...doc, given: undefined })));
  const b = await resumeArgs(root, 3, AT, {
    nameplate: "profiles/vorpal-mg90.json",
    policy: "policies/strict.json",
  });
  expect([b.nameplate, b.policy]).toEqual(["profiles/vorpal-mg90.json", "policies/strict.json"]);
  expect(b.files.map((f) => f.path)).not.toContain("policies/strict.json");
});
