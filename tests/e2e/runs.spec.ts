import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeZip } from "../../src/lib/zip";
import { RUN_UID, RUN_UTC, syntheticRun, type RunFileBytes } from "../fixtures/synthetic-run";

const WHEN = "2026-11-27 04:06:24 UTC";

function writeFolder(dir: string, files: readonly RunFileBytes[]): string {
  for (const f of files) {
    const path = join(dir, f.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, f.bytes);
  }
  return dir;
}

async function openRuns(page: Page): Promise<void> {
  await page.goto("/runs?sim=1");
  await expect(page.getByRole("heading", { name: "Identification runs" })).toBeVisible({
    timeout: 15_000,
  });
}

/** Every file under a folder of the page's OPFS, with its bytes. */
async function stored(page: Page, path: string): Promise<Record<string, number[]>> {
  return page.evaluate(async (path) => {
    let dir = await navigator.storage.getDirectory();
    for (const part of path.split("/")) dir = await dir.getDirectoryHandle(part);
    const out: Record<string, number[]> = {};
    const walk = async (d: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
      for await (const entry of d.values()) {
        if (entry instanceof FileSystemDirectoryHandle)
          await walk(entry, `${prefix}${entry.name}/`);
        else if (entry instanceof FileSystemFileHandle) {
          const file = await entry.getFile();
          out[`${prefix}${entry.name}`] = Array.from(new Uint8Array(await file.arrayBuffer()));
        }
      }
    };
    await walk(dir, "");
    return out;
  }, path);
}

const expected = Object.fromEntries(syntheticRun().map((f) => [f.path, Array.from(f.bytes)]));

test("an opened run folder lists under its servo with its time and how far it got, stored byte for byte", async ({
  page,
}, info) => {
  await openRuns(page);
  await expect(page.getByText("No runs yet.")).toBeVisible();
  const folder = writeFolder(info.outputPath(RUN_UTC), syntheticRun());
  await page.getByLabel("Run folder").setInputFiles(folder);
  await expect(page.getByRole("status")).toHaveText(
    `Opened the run of ${WHEN} for servo ${RUN_UID}, 7 files.`,
  );
  const servo = page.getByRole("region", { name: `Servo ${RUN_UID}` });
  await expect(servo).toContainText(WHEN);
  await expect(servo).toContainText("through the final check . vorpal-mg90 rev 3");
  const card = page.getByRole("region", { name: "Run" });
  await expect(card).toContainText(`${RUN_UID}/${RUN_UTC}/`);
  await expect(card).toContainText("osc-ident 0.1.0");
  await expect(card).toContainText("7 files");
  expect(await stored(page, `${RUN_UID}/${RUN_UTC}`)).toEqual(expected);

  await page.getByLabel("Run folder").setInputFiles(folder);
  await expect(page.getByRole("status")).toHaveText(
    `This run is already in the browser: the run of ${WHEN} for servo ${RUN_UID}.`,
  );

  // The run lives in the browser's storage, so a reload keeps it.
  await page.reload();
  await expect(page.getByRole("region", { name: `Servo ${RUN_UID}` })).toContainText(WHEN);
});

test("a run downloaded as a zip opens in another browser to the same files", async ({
  page,
  browser,
}, info) => {
  await openRuns(page);
  await page
    .getByLabel("Run folder")
    .setInputFiles(writeFolder(info.outputPath(RUN_UTC), syntheticRun()));
  await expect(page.getByRole("status")).toContainText("Opened the run");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download as zip" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(`${RUN_UID}-${RUN_UTC}.zip`);
  const zip = await download.path();

  const other = await browser.newContext();
  const fresh = await other.newPage();
  await openRuns(fresh);
  await fresh.getByLabel("Run zip").setInputFiles(zip);
  await expect(fresh.getByRole("status")).toHaveText(
    `Opened the run of ${WHEN} for servo ${RUN_UID}, 7 files.`,
  );
  expect(await stored(fresh, `${RUN_UID}/${RUN_UTC}`)).toEqual(expected);
  await other.close();
});

test("what is not a run folder is refused, naming why, and nothing is stored", async ({
  page,
}, info) => {
  await openRuns(page);
  const noRecord = syntheticRun().filter((f) => f.path !== "run.json");
  await page
    .getByLabel("Run folder")
    .setInputFiles(writeFolder(info.outputPath("results-only"), noRecord));
  await expect(page.getByRole("status")).toHaveText(
    "results-only was not opened: it holds no run.json, so it is not a run folder: open the <uid>/<UTC>/ folder osc-ident wrote, or a zip of it.",
  );

  const other = "0123456789abcdef0123456789abcdef";
  const filed = syntheticRun().map((f) => ({
    path: `${other}/${RUN_UTC}/${f.path}`,
    bytes: f.bytes,
  }));
  await page.getByLabel("Run zip").setInputFiles({
    name: "filed.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(writeZip(filed, new Date(0))),
  });
  await expect(page.getByRole("status")).toHaveText(
    `filed.zip was not opened: it is filed under servo ${other}, but its run.json names servo ${RUN_UID}.`,
  );

  const escaping = [
    ...syntheticRun().map((f) => ({ path: `${RUN_UTC}/${f.path}`, bytes: f.bytes })),
    { path: "../evil.json", bytes: new TextEncoder().encode("{}") },
  ];
  await page.getByLabel("Run zip").setInputFiles({
    name: "escaping.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(writeZip(escaping, new Date(0))),
  });
  await expect(page.getByRole("status")).toHaveText(
    'escaping.zip was not opened: it names a file outside its own folder ("../evil.json"), so nothing was copied.',
  );
  await expect(page.getByText("No runs yet.")).toBeVisible();
});
