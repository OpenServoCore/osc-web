import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { gotoSim, setSpeed } from "./helpers";

const UID_1 = "c94b8419d1092aec87de5fd151ce290f";

const PROFILE = JSON.parse(
  readFileSync(
    new URL("../../../open-servo-core/measure/testdata/mg90-d/profile.json", import.meta.url),
    "utf8",
  ),
) as Record<string, unknown>;

/**
 * The record's profile with a short slow time constant: the sim spends simulated time on a
 * resume's wait for the winding to cool, and stops itself past a simulated minute.
 */
const QUICK = { ...PROFILE, thermal: { ...(PROFILE.thermal as object), slow_tau_s: 5 } };

/** ID 1 of a simulated fleet, the record's profile chosen with Default, the bus at `speed`. */
async function openRun(page: Page, speed = "3 M", profile = PROFILE): Promise<void> {
  await gotoSim(page, [1]);
  await page.evaluate(async (profile) => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("profiles", { create: true });
    const writable = await (
      await dir.getFileHandle("vorpal-mg90.json", { create: true })
    ).createWritable();
    await writable.write(`${JSON.stringify(profile, null, 2)}\n`);
    await writable.close();
  }, profile);
  if (speed !== "1 M") await setSpeed(page, speed);
  await page.getByRole("button", { name: "ID 1" }).click();
  const card = page.getByRole("region", { name: "Identification" });
  await card.getByRole("combobox", { name: "Profile" }).click({ timeout: 15_000 });
  await page.getByRole("option", { name: "vorpal-mg90 rev 2", exact: true }).click();
  await card.getByRole("button", { name: "Identify" }).click();
  // A cold dev server compiles the run screen's chunk on this first request.
  await expect(page.getByRole("heading", { name: "Identify ID 1" })).toBeVisible({
    timeout: 15_000,
  });
}

function step(page: Page, title: string, within: Locator | Page = page): Locator {
  return within
    .getByRole("list", { name: "Steps" })
    .getByRole("listitem")
    .filter({ has: page.getByText(title, { exact: true }) });
}

/** A step's ring and icon: its state is its name, and which icon it shows is `data-mark`. */
function mark(page: Page, title: string, within?: Locator): Locator {
  return step(page, title, within).locator("[data-mark]");
}

async function expectMark(
  page: Page,
  title: string,
  kind: string,
  name: string,
  within?: Locator,
): Promise<void> {
  const m = mark(page, title, within);
  await expect(m).toHaveAttribute("data-mark", kind, { timeout: 30_000 });
  await expect(m).toHaveAccessibleName(`${title}: ${name}`);
}

async function storedRuns(page: Page, uid: string): Promise<string[]> {
  return page.evaluate(async (uid) => {
    const root = await navigator.storage.getDirectory();
    const names: string[] = [];
    try {
      const dir = await root.getDirectoryHandle(uid);
      for await (const entry of dir.values())
        if (entry.kind === "directory") names.push(entry.name);
    } catch {
      return [];
    }
    return names;
  }, uid);
}

async function readRunJson(page: Page, at: string): Promise<Record<string, unknown>> {
  return page.evaluate(async (at) => {
    let dir = await navigator.storage.getDirectory();
    for (const part of at.split("/")) dir = await dir.getDirectoryHandle(part);
    const file = await (await dir.getFileHandle("run.json")).getFile();
    return JSON.parse(await file.text()) as Record<string, unknown>;
  }, at);
}

test("a run on the simulated servo steps through rest, ends at the probe, and its report opens", async ({
  page,
}) => {
  await openRun(page);
  await expect(page.getByLabel("Run inputs")).toHaveText(
    "profile vorpal-mg90 rev 2 . policy Default . board facts read from the servo",
  );
  const worker = page.waitForEvent("worker");
  await page.getByRole("button", { name: "Start" }).click();
  // The run lives in a dedicated worker, whose timers a hidden tab does not throttle.
  expect((await worker).url()).toContain("ident.worker");
  await expectMark(page, "Rest", "accepted", "accepted");
  await expectMark(page, "Probe", "failed", "aborted");
  const outcome = page.getByRole("region", { name: "Run outcome" });
  await expect(outcome).toContainText("The run stopped at the probe", { timeout: 30_000 });
  await expectMark(page, "Stops", "not run", "not reached");
  await expectMark(page, "Gather", "not run", "not run");
  // The refusal's words stay under the step; the state's words are its mark's name.
  await expect(step(page, "Probe")).toContainText("shunt burst 0: burst stuck");
  await expect(page.getByLabel("Run lines")).toContainText("bus at 3000000 baud");

  const runs = await storedRuns(page, UID_1);
  expect(runs).toHaveLength(1);
  const at = `${UID_1}/${runs[0] ?? ""}`;
  await expect(outcome).toContainText(`${at}/`);
  const manifest = await readRunJson(page, at);
  expect(manifest.servo_uid).toBe(UID_1);
  expect(manifest.tool).toMatch(/^osc-client-web-ident /);
  const steps = manifest.steps as Record<string, { state: string }>;
  expect(steps.rest?.state).toBe("accepted");
  expect(steps.probe?.state).toBe("aborted");

  // The main client has the bus again: the fleet is scanned once more and ID 1 answers.
  await expect(page.getByRole("button", { name: "Connected at 3 M" })).toBeVisible();
  await expect(page.getByRole("button", { name: "ID 1" })).toBeVisible();

  await outcome.getByRole("link", { name: "Open the report" }).click();
  await expect(page.getByRole("heading", { name: "Identification report" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("stopped at the probe").first()).toBeVisible();

  await page.getByRole("link", { name: "Runs", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Runs" })).toContainText(
    "stopped at the probe",
  );
});

/**
 * Holds the ident worker's wasm until the returned release is called: a span before the run
 * starts, as long as a spec needs, for a click to land in.
 */
async function holdIdent(page: Page): Promise<() => void> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/osc_client_web_ident_bg.wasm*", async (route) => {
    await released;
    await route.continue();
  });
  return release;
}

test("Cancel ends the run with its first step interrupted, and the folder records it", async ({
  page,
}) => {
  await openRun(page);
  const release = await holdIdent(page);
  await page.getByRole("button", { name: "Start" }).click();
  const progress = page.getByRole("region", { name: "Run progress" });
  await expect(progress).toContainText("Loading the identification");
  await progress.getByRole("button", { name: "Cancel" }).click();
  await expect(progress).toContainText("Cancelling");
  release();
  const outcome = page.getByRole("region", { name: "Run outcome" });
  await expect(outcome).toContainText(
    "The run stopped at the rest step: interrupted: the step stopped between rungs.",
    { timeout: 30_000 },
  );
  await expectMark(page, "Rest", "interrupted", "interrupted");
  await expectMark(page, "Probe", "not run", "not reached");
  const runs = await storedRuns(page, UID_1);
  const manifest = await readRunJson(page, `${UID_1}/${runs[0] ?? ""}`);
  expect((manifest.steps as Record<string, { state: string }>).rest?.state).toBe("interrupted");
});

test("leaving the page mid-run is blocked, and closing the tab asks first", async ({ page }) => {
  await openRun(page);
  const release = await holdIdent(page);
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("region", { name: "Run progress" })).toBeVisible();
  await page.getByRole("link", { name: "Runs", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("A run is in progress");
  await expect(page.getByRole("heading", { name: "Identify ID 1" })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/identify");

  const asked = page.waitForEvent("dialog");
  await page.close({ runBeforeUnload: true });
  const dialog = await asked;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.dismiss();
  expect(page.isClosed()).toBe(false);

  release();
  await expect(page.getByRole("region", { name: "Run outcome" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "Runs", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Identification runs" })).toBeVisible();
});

test("below 3 M the run is refused before it starts: TEL streams at 3 M only", async ({ page }) => {
  await openRun(page, "1 M");
  await expect(page.getByRole("status")).toHaveText(
    "An identification captures on TEL bursts. TEL streams at 3 Mbaud only: raise the bus speed to 3 M, and use a short cable with good contacts.",
  );
  await expect(page.getByRole("button", { name: "Start" })).toBeDisabled();
});

interface Seen {
  label: string;
  mark: string;
  now: string | null;
}

/** Keeps every state each step mark is drawn in, from before the run starts. */
async function watchMarks(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: Seen[] = [];
    (window as { __marks?: Seen[] }).__marks = seen;
    const keep = () => {
      for (const el of document.querySelectorAll("[data-mark]")) {
        const s = {
          label: el.getAttribute("aria-label") ?? "",
          mark: el.getAttribute("data-mark") ?? "",
          now: el.getAttribute("aria-valuenow"),
        };
        const title = s.label.split(":")[0];
        const last = [...seen].reverse().find((x: Seen) => x.label.split(":")[0] === title);
        if (last?.label !== s.label || last.mark !== s.mark || last.now !== s.now) seen.push(s);
      }
    };
    new MutationObserver(keep).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-label", "data-mark", "aria-valuenow"],
    });
  });
}

async function seenMarks(page: Page, title: string): Promise<Seen[]> {
  const all = await page.evaluate(() => (window as { __marks?: Seen[] }).__marks ?? []);
  return all.filter((s) => s.label.startsWith(`${title}: `));
}

test("each step's ring advances with its units, never goes back, and its icon follows its state", async ({
  page,
}) => {
  await openRun(page);
  await watchMarks(page);
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("region", { name: "Run outcome" })).toBeVisible({ timeout: 30_000 });

  const rest = await seenMarks(page, "Rest");
  const ring = rest.filter((s) => s.mark === "running").map((s) => Number(s.now));
  expect(ring.length).toBeGreaterThan(0);
  for (let i = 1; i < ring.length; i++) expect(ring[i]).toBeGreaterThanOrEqual(ring[i - 1] ?? 0);
  expect(rest.map((s) => s.mark).filter((m, i, a) => a[i - 1] !== m)).toEqual([
    "waiting",
    "running",
    "accepted",
  ]);
  // The rest's two bursts: the ring stands at a half while the second runs.
  expect(rest.some((s) => s.mark === "running" && s.label === "Rest: running, burst 2 of 2")).toBe(
    true,
  );
  expect(ring).toContain(50);
  const probe = await seenMarks(page, "Probe");
  expect(probe.map((s) => s.mark).filter((m, i, a) => a[i - 1] !== m)).toEqual([
    "waiting",
    "running",
    "failed",
  ]);
  expect(probe.some((s) => s.label === "Probe: running, burst 1 of 17")).toBe(true);

  // Each mark's words are its accessible name and its tooltip.
  const steps = page.getByRole("list", { name: "Steps" });
  await expect(steps.getByRole("img", { name: "Rest: accepted" })).toBeVisible();
  await expect(steps.getByRole("img", { name: "Probe: aborted" })).toBeVisible();
  await expect(steps.getByRole("img", { name: "Table: not reached" })).toBeVisible();
  await expect(steps.getByRole("img", { name: "Final check: not run" })).toBeVisible();
  await expect(steps.getByRole("progressbar")).toHaveCount(0);
  await mark(page, "Probe").hover();
  await expect(page.getByRole("tooltip")).toHaveText("Probe: aborted");
});

test("a run cancelled mid-run is shown interrupted and offers Resume from the step it stopped in", async ({
  page,
}) => {
  await openRun(page, "3 M", QUICK);
  const release = await holdIdent(page);
  await page.getByRole("button", { name: "Start" }).click();
  const progress = page.getByRole("region", { name: "Run progress" });
  await progress.getByRole("button", { name: "Cancel" }).click();
  release();
  const outcome = page.getByRole("region", { name: "Run outcome" });
  await expect(outcome).toContainText("The run stopped at the rest step", { timeout: 30_000 });
  await expectMark(page, "Rest", "interrupted", "interrupted");

  await outcome.getByRole("button", { name: "Resume" }).click();
  const stoppedRun = page.getByRole("region", { name: "Stopped run" });
  await expect(stoppedRun).toContainText("stopped at the rest step");
  await expectMark(page, "Rest", "interrupted", "interrupted", stoppedRun);
  await expectMark(page, "Probe", "not run", "not reached", stoppedRun);
  const plan = stoppedRun.getByLabel("Resume plan");
  await expect(plan).toContainText(
    "Resume goes on in the same folder from the rest step, as segment 2.",
    { timeout: 15_000 },
  );
  await expect(plan).toContainText("for the winding to cool");
  await expect(stoppedRun.getByRole("button", { name: "Resume" })).toBeEnabled();
});

test("a stopped run resumes from the browser's copy of its folder, through to the run's end", async ({
  page,
}) => {
  await openRun(page, "3 M", QUICK);
  await page.getByRole("button", { name: "Start" }).click();
  const outcome = page.getByRole("region", { name: "Run outcome" });
  await expect(outcome).toContainText("The run stopped at the probe", { timeout: 30_000 });
  const runs = await storedRuns(page, UID_1);
  expect(runs).toHaveLength(1);
  const at = `${UID_1}/${runs[0] ?? ""}`;

  await outcome.getByRole("button", { name: "Resume" }).click();
  const stoppedRun = page.getByRole("region", { name: "Stopped run" });
  await expect(stoppedRun.getByLabel("Resume plan")).toContainText(
    "Resume goes on in the same folder from the probe, as segment 2.",
    { timeout: 15_000 },
  );
  await watchMarks(page);
  await stoppedRun.getByRole("button", { name: "Resume" }).click();

  await expect(outcome).toContainText("The resumed run ended", { timeout: 30_000 });
  await expect(outcome).not.toContainText("refused");
  await expectMark(page, "Resume", "accepted", "accepted");
  await expectMark(page, "Rest", "accepted", "accepted");
  await expectMark(page, "Probe", "failed", "aborted");
  await expectMark(page, "Gather", "not run", "not run");
  // The resume's own row is above the steps, and its ring went round with the cooling wait.
  await expect(
    page.getByRole("list", { name: "Steps" }).getByRole("listitem").first(),
  ).toContainText("Resume");
  const resume = await seenMarks(page, "Resume");
  const cooling = resume.filter((s) => s.label.includes("s cooling")).map((s) => Number(s.now));
  expect(cooling.length).toBeGreaterThan(0);
  for (let i = 1; i < cooling.length; i++) {
    expect(cooling[i]).toBeGreaterThanOrEqual(cooling[i - 1] ?? 0);
  }
  expect(await storedRuns(page, UID_1)).toEqual(runs);

  const manifest = await readRunJson(page, at);
  const segments = manifest.segments as { n: number; from: string }[];
  expect(segments.map((s) => [s.n, s.from])).toEqual([
    [1, "rest"],
    [2, "probe"],
  ]);
  const steps = manifest.steps as Record<string, { state: string; segment: number }>;
  expect(steps.rest).toMatchObject({ state: "accepted", segment: 1 });
  expect(steps.probe).toMatchObject({ state: "aborted", segment: 2 });
  const moved = await page.evaluate(async (at) => {
    let dir = await navigator.storage.getDirectory();
    for (const part of `${at}/segments/1/results`.split("/"))
      dir = await dir.getDirectoryHandle(part);
    const names: string[] = [];
    for await (const e of dir.values()) names.push(e.name);
    return names.sort();
  }, at);
  expect(moved).toEqual(["probe.json"]);
});

test("a stopped run in the list offers Resume; the page says what the module refuses, in its words", async ({
  page,
}) => {
  await openRun(page);
  await page.getByRole("button", { name: "Start" }).click();
  const outcome = page.getByRole("region", { name: "Run outcome" });
  await expect(outcome).toContainText("The run stopped at the probe", { timeout: 30_000 });
  const runs = await storedRuns(page, UID_1);
  const at = `${UID_1}/${runs[0] ?? ""}`;
  // The profile edited since: a resume would measure on another profile.
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("profiles");
    const file = await dir.getFileHandle("vorpal-mg90.json");
    const text = await (await file.getFile()).text();
    const w = await file.createWritable();
    await w.write(text.replace('"revision": 2', '"revision": 3'));
    await w.close();
  });

  await page.getByRole("link", { name: "Runs", exact: true }).click();
  const card = page.getByRole("region", { name: "Run" });
  await card.getByRole("link", { name: "Resume" }).click();
  await expect(page.getByRole("heading", { name: "Identify ID 1" })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("resume")).toBe(at);
  const stoppedRun = page.getByRole("region", { name: "Stopped run" });
  await expect(stoppedRun.getByRole("status")).toContainText(
    "profiles/vorpal-mg90.json is not the profile the run began with (sha1 ",
    { timeout: 15_000 },
  );
  await expect(stoppedRun.getByRole("button", { name: "Resume" })).toBeDisabled();
});

test("a page reloaded mid-run leaves its folder in the browser, the step it was in shown cut off, and Resume goes on from it", async ({
  page,
}) => {
  await openRun(page, "3 M", QUICK);
  await page.getByRole("button", { name: "Start" }).click();
  await expect(mark(page, "Probe")).toHaveAttribute("data-mark", "running", { timeout: 30_000 });
  // The mirror has the probe begun once run.json says so.
  await page.waitForFunction(async (uid) => {
    try {
      const root = await navigator.storage.getDirectory();
      const servo = await root.getDirectoryHandle(uid);
      for await (const run of servo.values()) {
        if (run.kind !== "directory") continue;
        const f = await (await run.getFileHandle("run.json")).getFile();
        const doc = JSON.parse(await f.text()) as { steps?: { probe?: { state?: string } } };
        if (doc.steps?.probe?.state === "running") return true;
      }
    } catch {
      return false;
    }
    return false;
  }, UID_1);
  page.on("dialog", (d) => void d.accept());
  await page.reload();
  await expect(page.getByRole("button", { name: /^Connected/ })).toBeVisible({ timeout: 15_000 });
  const stoppedRun = page.getByRole("region", { name: "Stopped run" });
  // The sim came back at its first speed; a resume captures on TEL bursts too.
  await page.getByRole("button", { name: "ID 1" }).click();
  await page
    .getByRole("region", { name: "Identification" })
    .getByRole("button", { name: "Identify" })
    .click({ timeout: 15_000 });
  await expect(stoppedRun.getByRole("status")).toContainText("TEL streams at 3 Mbaud only");
  await expect(stoppedRun.getByRole("button", { name: "Resume" })).toBeDisabled();
  await setSpeed(page, "3 M");
  await expectMark(page, "Rest", "accepted", "accepted", stoppedRun);
  await expectMark(
    page,
    "Probe",
    "interrupted",
    "no end recorded: the run was cut off",
    stoppedRun,
  );
  await expect(stoppedRun.getByLabel("Resume plan")).toContainText("from the probe, as segment 2", {
    timeout: 15_000,
  });
  await stoppedRun.getByRole("button", { name: "Resume" }).click();
  const outcome = page.getByRole("region", { name: "Run outcome" });
  await expect(outcome).toContainText("The resumed run ended", { timeout: 30_000 });
  await expectMark(page, "Resume", "accepted", "accepted");
  await expectMark(page, "Probe", "failed", "aborted");
  const runs = await storedRuns(page, UID_1);
  expect(runs).toHaveLength(1);
  const manifest = await readRunJson(page, `${UID_1}/${runs[0] ?? ""}`);
  expect((manifest.segments as { from: string }[]).map((s) => s.from)).toEqual(["rest", "probe"]);
});

const TESTDATA = new URL("../../../open-servo-core/measure/testdata/", import.meta.url);
const RECORDED = "run/00000000ffffffff76e5bc220ef6abcd/20261127T130203Z/run.json";
const text = (rel: string): string => readFileSync(new URL(rel, TESTDATA), "utf8");
const SHOTS = process.env.SHOTS_DIR;

/**
 * The recorded run's run.json moved onto ID 1 of the simulated fleet, its final set the set of
 * record with its table: a folder whose final check accepted a set this servo can take.
 */
function acceptedFolder(uid = UID_1): { at: string; files: { path: string; text: string }[] } {
  const set = text("mg90-d/constants.json");
  const run = JSON.parse(text(RECORDED)) as Record<string, unknown> & {
    final: Record<string, unknown>;
  };
  run.servo_uid = uid;
  run.final = {
    ...run.final,
    set: (JSON.parse(set) as { hash: { set: string } }).hash.set,
    set_file: "final/set.json",
  };
  const at = `${uid}/20261127T130203Z`;
  return {
    at,
    files: [
      { path: `${at}/run.json`, text: `${JSON.stringify(run, null, 2)}\n` },
      { path: `${at}/final/set.json`, text: set },
      { path: `${at}/final/inputs/pos_lut.json`, text: text("mg90-d/pos_lut.json") },
    ],
  };
}

type Told = Record<string, unknown>;

/**
 * The next `count` run workers the page makes are a script: it tells `events`, writes `files`
 * through the page's mirror, and ends with an accepted outcome when `ends`, else holds the run
 * open. The sim runs no motor, so only a script reaches the tune; workers after it are the real
 * module's.
 */
async function scriptedWorker(
  page: Page,
  script: { events: Told[]; files?: { path: string; text: string }[]; ends: boolean },
  count = 1,
): Promise<void> {
  let left = count;
  const body = `
const S = ${JSON.stringify({ files: [], ...script })};
const enc = new TextEncoder();
const files = () => S.files.map((f) => ({ path: f.path, bytes: enc.encode(f.text) }));
self.postMessage({ kind: "ready" });
self.onmessage = async (e) => {
  if (e.data.kind !== "runFake") return;
  for (const f of files()) self.postMessage({ kind: "store", stored: { op: "write", ...f } });
  for (const p of S.events) {
    self.postMessage({ kind: "progress", progress: p });
    await new Promise((go) => setTimeout(go, 5));
  }
  if (!S.ends) return;
  const root = S.files[0]?.path.split("/").slice(0, 2).join("/");
  self.postMessage({
    kind: "outcome",
    outcome: { root, files: files(), lines: ["the scripted run"], accepted: true },
  });
};`;
  await page.route(/ident\.worker\.ts/, async (route) => {
    if (left <= 0) return route.fallback();
    left -= 1;
    await route.fulfill({ contentType: "text/javascript", body });
  });
}

const ACCEPTED_BEFORE_TUNE: Told[] = [
  "rest",
  "probe",
  "stops",
  "table",
  "window",
  "spins",
  "gather",
].flatMap((step) => [
  { event: "started", step },
  { event: "ended", step, state: "accepted", why: null },
]);

const TUNE_AT_TRY_2: Told[] = [
  ...ACCEPTED_BEFORE_TUNE,
  { event: "started", step: "tune" },
  { event: "try", step: "tune", at: 1, of: 6, percent: 100 },
  { event: "unit", step: "tune", at: 1, of: 20, what: "move" },
  { event: "unit", step: "tune", at: 20, of: 20, what: "move" },
  { event: "try", step: "tune", at: 2, of: 6, percent: 80 },
  { event: "unit", step: "tune", at: 1, of: 20, what: "move" },
  { event: "unit", step: "tune", at: 5, of: 20, what: "move" },
];

test("the tune's ring spans its six tries, and its row says only which try past the first", async ({
  page,
}) => {
  await openRun(page);
  await scriptedWorker(page, { events: TUNE_AT_TRY_2, ends: false });
  await page.getByRole("button", { name: "Start" }).click();
  const tune = mark(page, "Tune");
  await expect(tune).toHaveAttribute("data-mark", "running", { timeout: 30_000 });
  await expect(tune).toHaveAccessibleName(
    "Tune: running, try 2 of at most 6 at 80% of the starting gain, move 5 of 20",
  );
  // Try 2 of 6 at move 5 of 20: one try's sixth and four twentieths of the next.
  await expect(tune).toHaveAttribute("aria-valuenow", String(Math.round((100 * (1 + 4 / 20)) / 6)));
  // Beside the name: "try 2" alone, no unit words; the moves and the gain are in the tooltip.
  await expect(step(page, "Tune")).toContainText("try 2");
  await expect(step(page, "Tune")).not.toContainText("move");
  await expect(step(page, "Tune")).not.toContainText("of at most");
  await shoot(page, page.getByRole("list", { name: "Steps" }), "steps-tune-try-2");
});

/** Screenshots of `what` in both themes into SHOTS_DIR, when it is set. */
async function shoot(page: Page, what: Locator, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await what.screenshot({ path: `${SHOTS}/${name}-${colorScheme}.png` });
  }
  await page.emulateMedia({ colorScheme: null });
}

test("an accepted run saves its final set from the folder and reads it back clean", async ({
  page,
}) => {
  const folder = acceptedFolder();
  await openRun(page);
  await scriptedWorker(page, {
    events: [
      ...ACCEPTED_BEFORE_TUNE,
      { event: "started", step: "tune" },
      { event: "try", step: "tune", at: 1, of: 6, percent: 100 },
      { event: "ended", step: "tune", state: "accepted", why: null },
      { event: "started", step: "cruise" },
      { event: "ended", step: "cruise", state: "accepted", why: null },
      { event: "started", step: "final" },
      { event: "try", step: "final", at: 1, of: 6, percent: 100 },
      { event: "try", step: "final", at: 2, of: 6, percent: 80 },
      { event: "ended", step: "final", state: "accepted", why: null },
    ],
    files: folder.files,
    ends: true,
  });
  await page.getByRole("button", { name: "Start" }).click();
  const outcome = page.getByRole("region", { name: "Run outcome" });
  await expect(outcome).toBeVisible({ timeout: 30_000 });
  await expectMark(
    page,
    "Tune",
    "accepted",
    "accepted, try 1 of at most 6 at 100% of the starting gain",
  );
  await expect(step(page, "Tune")).not.toContainText("try");
  // The final check counts its own tries: its second, though the folder numbers it try 3.
  await expect(step(page, "Final check")).toContainText("try 2");
  await shoot(page, page.getByRole("list", { name: "Steps" }), "steps-accepted");

  const save = outcome.getByRole("region", { name: "Save this set" });
  await expect(save).toContainText("stores the bus speed the servo runs at now, 3 M");
  await save.getByRole("button", { name: "Save this set" }).click();
  await expect(save.getByLabel("Save result")).toHaveText(
    /^Saved\. The servo reads back as the run's final set: 0 differences\. It starts at 3 M\. The backup is in this browser at c94b8419d1092aec87de5fd151ce290f\/\d{8}T\d{6}Z\/\.$/,
    { timeout: 30_000 },
  );
  await save.getByText("The tool's lines").click();
  await expect(save.getByLabel("Save lines")).toContainText("SAVE: CONFIG and CALIB are in flash");
  await expect(save.getByLabel("Save lines")).toContainText(
    "0 differences; settings loaded; unsaved no",
  );
  await shoot(page, outcome, "save-this-set");
  // The backup sits in a folder of its own beside the run's, as osc-ident save keeps it.
  const runs = await storedRuns(page, UID_1);
  expect(runs).toHaveLength(2);
  // The main client has the bus again.
  await expect(page.getByRole("button", { name: "Connected at 3 M" })).toBeVisible();
  await expect(page.getByRole("button", { name: "ID 1" })).toBeVisible();
});

test("the report of another servo's accepted run refuses Save this set plainly", async ({
  page,
}) => {
  const other = "0123456789abcdef0123456789abcdef";
  const folder = acceptedFolder(other);
  await gotoSim(page, [1]);
  await page.evaluate(async (files) => {
    const root = await navigator.storage.getDirectory();
    for (const f of files) {
      const parts = f.path.split("/");
      const name = parts.pop() ?? "";
      let dir = root;
      for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true });
      const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await w.write(f.text);
      await w.close();
    }
  }, folder.files);
  await page.goto(`/runs/${folder.at}?sim=1`);
  const save = page.getByRole("region", { name: "Save this set" });
  await expect(save.getByRole("status")).toHaveText(
    `Servo ${other} is not on the bus: connect it to save this set.`,
    { timeout: 15_000 },
  );
  await expect(save.getByRole("button", { name: "Save this set" })).toBeDisabled();
});
