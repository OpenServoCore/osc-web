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

/** ID 1 of a simulated fleet, the record's profile chosen with Default, the bus at `speed`. */
async function openRun(page: Page, speed = "3 M"): Promise<void> {
  await gotoSim(page, [1]);
  await page.evaluate(async (profile) => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("profiles", { create: true });
    const writable = await (
      await dir.getFileHandle("vorpal-mg90.json", { create: true })
    ).createWritable();
    await writable.write(`${JSON.stringify(profile, null, 2)}\n`);
    await writable.close();
  }, PROFILE);
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

function step(page: Page, title: string): Locator {
  return page
    .getByRole("list", { name: "Steps" })
    .getByRole("listitem")
    .filter({ has: page.getByText(title, { exact: true }) });
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
  await expect(step(page, "Rest")).toContainText("accepted", { timeout: 30_000 });
  await expect(step(page, "Probe")).toContainText("aborted", { timeout: 30_000 });
  const outcome = page.getByRole("region", { name: "Run outcome" });
  await expect(outcome).toContainText("The run stopped at the probe", { timeout: 30_000 });
  await expect(step(page, "Stops")).toContainText("not reached");
  await expect(step(page, "Gather")).toContainText("not run");
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
  await expect(step(page, "Rest")).toContainText("interrupted");
  await expect(step(page, "Probe")).toContainText("not reached");
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
