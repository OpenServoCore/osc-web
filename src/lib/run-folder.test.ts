import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { RUN_UID, RUN_UTC, runManifest, syntheticRun } from "../../tests/fixtures/synthetic-run";
import { listTree, readFile, writeFile, type OpfsDir } from "./opfs";
import { memoryOpfs } from "./opfs-fake";
import {
  exportRun,
  filesOfZip,
  importRun,
  listRuns,
  locateRun,
  reachOf,
  sizeText,
  utcOf,
  utcText,
  zipName,
  type RunStep,
} from "./run-folder";
import { readZip, writeZip, type ZipEntry } from "./zip";

const under = (prefix: string, files: readonly ZipEntry[]): ZipEntry[] =>
  files.map((f) => ({ path: `${prefix}${f.path}`, bytes: f.bytes }));

const json = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);

function withRunJson(manifest: unknown): ZipEntry[] {
  return syntheticRun().map((f) =>
    f.path === "run.json" ? { path: f.path, bytes: json(manifest) } : f,
  );
}

test("a picked run folder gives its uid from run.json and its UTC from the folder name", () => {
  const run = locateRun(under(`${RUN_UTC}/`, syntheticRun()));
  expect(run.identity).toMatchObject({
    uid: RUN_UID,
    utc: RUN_UTC,
    tool: "osc-ident 0.1.0",
    image: "production",
    reach: "through the final check",
    profile: { key: "vorpal-mg90", revision: 3 },
    policy: { key: "default", revision: null },
  });
  expect(run.identity.steps.map((s) => s.name)).toEqual([
    "rest",
    "probe",
    "stops",
    "table",
    "window",
    "spins",
    "gather",
    "tune",
    "cruise",
    "final",
  ]);
  // The top folder is stripped: paths are the run folder's own.
  expect(run.files.map((f) => f.path)).toEqual(syntheticRun().map((f) => f.path));
});

test("files at the top, or under <uid>/<UTC>/, are the same run", () => {
  const bare = locateRun(syntheticRun());
  const filed = locateRun(under(`${RUN_UID}/${RUN_UTC}/`, syntheticRun()));
  expect(filed.identity).toEqual(locateRun(under(`${RUN_UTC}/`, syntheticRun())).identity);
  expect(filed.files).toEqual(bare.files);
});

test("a folder not named for a time takes the earliest start in run.json", () => {
  const run = locateRun(under("my-run/", syntheticRun()));
  expect(run.identity.utc).toBe(RUN_UTC);
  expect(utcOf(0)).toBe("19700101T000000Z");
  expect(utcOf(951_782_400.9)).toBe("20000229T000000Z");
  expect(utcText(RUN_UTC)).toBe("2026-11-27 04:06:24 UTC");
  expect([999, 1_234, 25_300_000].map(sizeText)).toEqual(["999 bytes", "1.2 kB", "25.3 MB"]);
});

test("macOS side files are left out", async () => {
  const zip = new Uint8Array(
    readFileSync(new URL("../../tests/fixtures/run-finder.zip", import.meta.url)),
  );
  const run = locateRun([
    ...(await filesOfZip(zip)),
    { path: "20261127T040624Z/.DS_Store", bytes: new Uint8Array(4) },
  ]);
  expect(run.identity.uid).toBe("00000000ffffffff76e5bc220ef6abcd");
  expect(run.files.map((f) => f.path)).toEqual([
    "captures/rest/02-raw.csv.gz",
    "results/rest.json",
    "run.json",
  ]);
  expect(run.identity.reach).toBe("through the rest step");
});

test("what is not one run folder is refused, naming why", () => {
  const refused = (files: ZipEntry[]) => () => locateRun(files);
  const results = syntheticRun().filter((f) => f.path !== "run.json");
  expect(refused(under(`${RUN_UTC}/`, results))).toThrow(
    "it holds no run.json, so it is not a run folder",
  );
  expect(refused([])).toThrow("it holds no files");
  expect(refused(withRunJson({ ...runManifest(), servo_uid: "1A2B" }))).toThrow(
    'its run.json names the servo "1A2B", which is not a uid of 32 lowercase hex digits',
  );
  const { servo_uid: _, ...noUid } = runManifest();
  expect(refused(withRunJson(noUid))).toThrow("its run.json names no servo_uid");
  const { steps: __, ...noSteps } = runManifest();
  expect(refused(withRunJson(noSteps))).toThrow("its run.json lists no steps");
  expect(refused([{ path: "run.json", bytes: new TextEncoder().encode("not json") }])).toThrow(
    "its run.json is not JSON",
  );
  const other = "0123456789abcdef0123456789abcdef";
  expect(refused(under(`${other}/${RUN_UTC}/`, syntheticRun()))).toThrow(
    `it is filed under servo ${other}, but its run.json names servo ${RUN_UID}`,
  );
  expect(
    refused([
      ...under(`${RUN_UTC}/`, syntheticRun()),
      { path: `${RUN_UTC}/../../evil.json`, bytes: json({}) },
    ]),
  ).toThrow('it names a file outside its own folder ("20261127T040624Z/../../evil.json")');
  expect(refused([...syntheticRun(), { path: "/etc/passwd", bytes: json({}) }])).toThrow(
    "outside its own folder",
  );
  expect(refused([...under("a/", syntheticRun()), ...under("b/", syntheticRun())])).toThrow(
    "it holds 2 runs (a/, b/): open one run folder",
  );
  expect(refused([...under("a/", syntheticRun()), { path: "notes.txt", bytes: json({}) }])).toThrow(
    "it holds files beside the run folder (notes.txt)",
  );
  expect(refused(under("runs/x/", syntheticRun()))).toThrow(
    "its run.json is in runs/x/, more than one folder down",
  );
});

test("how far a run got reads its entries in order", () => {
  const s = (name: string, state: string): RunStep => ({ name, state, why: null });
  expect(reachOf([s("rest", "accepted"), s("probe", "refused"), s("stops", "not run")])).toBe(
    "stopped at the probe",
  );
  expect(reachOf([s("rest", "accepted"), s("probe", "accepted"), s("stops", "accepted")])).toBe(
    "through the stops",
  );
  expect(reachOf([s("spins", "accepted"), s("gather", "not run"), s("tune", "not run")])).toBe(
    "through the spins",
  );
  expect(reachOf([s("table", "interrupted")])).toBe("stopped at the table");
  expect(reachOf([])).toBe("no step recorded");
});

async function stored(root: OpfsDir): Promise<ZipEntry[]> {
  const at = `${RUN_UID}/${RUN_UTC}`;
  const out: ZipEntry[] = [];
  for (const f of await listTree(root, at)) {
    const bytes = await readFile(root, `${at}/${f.path}`);
    if (bytes !== null) out.push({ path: f.path, bytes });
  }
  return out;
}

test("an import copies the run byte for byte to <uid>/<UTC>/ and the same run again writes nothing", async () => {
  const root = memoryOpfs();
  const run = locateRun(under(`${RUN_UTC}/`, syntheticRun()));
  const seen: number[] = [];
  expect(await importRun(root, run, (n) => seen.push(n))).toBe("opened");
  expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7]);
  const sorted = (files: ZipEntry[]) => [...files].sort((a, b) => (a.path < b.path ? -1 : 1));
  expect(await stored(root)).toEqual(sorted(syntheticRun()));
  expect(await importRun(root, run, () => seen.push(0))).toBe("already");
  expect(seen).toHaveLength(7);
});

test("a different run at the same <uid>/<UTC>/ is refused and the stored one kept", async () => {
  const root = memoryOpfs();
  await importRun(root, locateRun(under(`${RUN_UTC}/`, syntheticRun())));
  const changed = syntheticRun().map((f) =>
    f.path === "results/rest.json" ? { path: f.path, bytes: json({ estimates: {} }) } : f,
  );
  await expect(importRun(root, locateRun(under(`${RUN_UTC}/`, changed)))).rejects.toThrow(
    `a different run is already in the browser at ${RUN_UID}/${RUN_UTC}/; nothing was copied`,
  );
  const fewer = syntheticRun().filter((f) => f.path !== "final/set.json");
  await expect(importRun(root, locateRun(under(`${RUN_UTC}/`, fewer)))).rejects.toThrow(
    "a different run",
  );
  expect(await readFile(root, `${RUN_UID}/${RUN_UTC}/results/rest.json`)).toEqual(
    syntheticRun().find((f) => f.path === "results/rest.json")?.bytes,
  );
});

test("a copy that fails part way leaves no run behind", async () => {
  const root = memoryOpfs();
  const run = locateRun(syntheticRun());
  let calls = 0;
  // Every write opens the uid folder from the root; the fourth runs out of space.
  const flaky: OpfsDir = {
    kind: "directory",
    name: "",
    getDirectoryHandle: async (name, options) => {
      if (options?.create === true && ++calls > 3) {
        throw new DOMException("full", "QuotaExceededError");
      }
      return root.getDirectoryHandle(name, options);
    },
    getFileHandle: (name, options) => root.getFileHandle(name, options),
    values: () => root.values(),
    removeEntry: (name, options) => root.removeEntry(name, options),
  };
  await expect(importRun(flaky, run)).rejects.toThrow("full");
  expect(await listTree(root, RUN_UID)).toEqual([]);
});

test("a copy cut short, with no run.json yet, is not listed and the next import replaces it", async () => {
  const root = memoryOpfs();
  const at = `${RUN_UID}/${RUN_UTC}`;
  await writeFile(root, `${at}/results/rest.json`, json({ half: "written" }));
  expect(await listRuns(root)).toEqual([]);
  expect(await importRun(root, locateRun(under(`${RUN_UTC}/`, syntheticRun())))).toBe("opened");
  expect(await stored(root)).toHaveLength(syntheticRun().length);
  expect(await readFile(root, `${at}/results/rest.json`)).toEqual(
    syntheticRun().find((f) => f.path === "results/rest.json")?.bytes,
  );
});

test("an exported run is one <UTC>/ folder that imports again to the same bytes", async () => {
  const root = memoryOpfs();
  await importRun(root, locateRun(under(`${RUN_UTC}/`, syntheticRun())));
  const zip = await exportRun(root, RUN_UID, RUN_UTC);
  expect(zip).not.toBeNull();
  if (zip === null) return;
  expect(zipName(RUN_UID, RUN_UTC)).toBe(`${RUN_UID}-${RUN_UTC}.zip`);
  const entries = await readZip(zip);
  expect(entries.every((e) => e.path.startsWith(`${RUN_UTC}/`))).toBe(true);
  const again = memoryOpfs();
  expect(await importRun(again, locateRun(await filesOfZip(zip)))).toBe("opened");
  expect(await stored(again)).toEqual(await stored(root));
  expect(await exportRun(again, RUN_UID, RUN_UTC)).toEqual(zip);
  expect(await exportRun(again, RUN_UID, "20261127T000000Z")).toBeNull();
});

test("the browser's runs list newest first with what each holds", async () => {
  const root = memoryOpfs();
  await importRun(root, locateRun(under(`${RUN_UTC}/`, syntheticRun())));
  const probeRefused = {
    ...runManifest(),
    steps: {
      rest: { state: "accepted", why: null, started: 1795800000, ended: 1795800002 },
      probe: {
        state: "refused",
        why: "the horn moved at rest",
        started: 1795800002,
        ended: 1795800003,
      },
    },
    gather: { state: "not run", why: "not every step was accepted" },
  };
  await importRun(root, locateRun(under("20261127T171000Z/", withRunJson(probeRefused))));
  // A servo's setup and a folder with no run.json beside the runs are not runs.
  await writeFile(root, `${RUN_UID}/setup.json`, json({ profile: null, policy: null }));
  await writeFile(root, `${RUN_UID}/20261101T000000Z/backup/stored.json`, json({}));
  const runs = await listRuns(root);
  expect(runs.map((r) => [r.identity.utc, r.identity.reach, r.files])).toEqual([
    ["20261127T171000Z", "stopped at the probe", 7],
    [RUN_UTC, "through the final check", 7],
  ]);
  expect(runs[0]?.identity.steps[1]).toEqual({
    name: "probe",
    state: "refused",
    why: "the horn moved at rest",
  });
  expect(runs[1]?.bytes).toBe(syntheticRun().reduce((n, f) => n + f.bytes.length, 0));
  expect(runs[1]?.identity.profile).toEqual({ key: "vorpal-mg90", revision: 3 });
});

test("a zip that cannot be read is refused in its own words", async () => {
  await expect(filesOfZip(new TextEncoder().encode("plain text"))).rejects.toThrow(
    expect.objectContaining({ name: "RunRefused", message: "it is not a zip file" }),
  );
  const zip = writeZip([{ path: "x/run.json", bytes: json(runManifest()) }], new Date(0));
  expect((await filesOfZip(zip)).map((f) => f.path)).toEqual(["x/run.json"]);
});
