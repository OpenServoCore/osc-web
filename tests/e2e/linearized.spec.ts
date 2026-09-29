import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { counts, GRID } from "../../src/lib/pos-lut";
import { gotoSim, MG90A, writeTable } from "./helpers";

async function openLive(page: Page): Promise<void> {
  await page.getByRole("button", { name: "ID 1" }).click();
  await expect(page.getByRole("heading", { name: "ID 1" })).toBeVisible();
  await page.getByRole("link", { name: "Live" }).click();
  await expect(page.getByRole("region", { name: /^Motion/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("waiting for data")).toHaveCount(0);
}

test("without a table the position is the pot as read, and says nothing about it", async ({
  page,
}) => {
  await gotoSim(page, [1, 2]);
  await openLive(page);
  await expect(page.getByLabel("Position value")).toHaveText(/ deg$/);
  await expect(page.getByLabel("Position raw")).toHaveCount(0);
  await expect(page.getByRole("switch", { name: "Position (linearized)" })).toHaveCount(0);
});

test("with a live table the position is read through it, the raw sample beside it", async ({
  page,
}) => {
  await gotoSim(page, [1, 2]);
  await writeTable(page, 1, MG90A.points);
  await openLive(page);
  await expect(page.getByRole("switch", { name: "Position (linearized)" })).toBeVisible();
  await expect(page.getByLabel("Position (linearized) value")).toHaveText(/ deg$/);
  await expect(page.getByLabel("Position raw")).toHaveText(/^raw \d+ counts$/);
  // Raw units: the readout is the firmware's own interpolation of the sample
  // beside it (protocol sec 5.7), to the 1/16 count the Q4 word carries.
  await page.getByRole("tab", { name: "Raw" }).click();
  await page.getByRole("button", { name: "Pause" }).click();
  const readout = page.getByLabel("Position (linearized) value");
  await expect(readout).toHaveText(/^\d+\.\d counts$/);
  const raw = Number(/\d+/.exec((await page.getByLabel("Position raw").textContent()) ?? "")?.[0]);
  expect(await readout.textContent()).toBe(`${counts(MG90A.points, raw).toFixed(1)} counts`);
  expect(GRID).toBe(16);
});

test("a burst can carry the linearized pot, in degrees through the same angle map", async ({
  page,
}) => {
  await gotoSim(page, [1, 2]);
  await page.getByRole("button", { name: "ID 1" }).click();
  await page.getByRole("link", { name: "Live" }).click();
  await page.getByRole("tab", { name: "Stream" }).click({ timeout: 15_000 });
  await expect(page.getByText(/ samples = [\d.]+ ms at \d+ kHz$/)).toBeVisible();
  for (const name of ["Current raw", "Motor A", "Motor B", "Bus raw"]) {
    await page.getByRole("checkbox", { name, exact: true }).click();
  }
  await page.getByRole("checkbox", { name: "Position (linearized)", exact: true }).click();
  await expect(page.getByText("tel_mask 0x0801 - tel_count 120")).toBeVisible();
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await expect(page.getByLabel("Capture summary")).toHaveText(/ samples, /);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download .csv" }).click(),
  ]);
  const lines = (await readFile(await download.path(), "utf8")).split("\n");
  expect(lines[0]).toBe("sample,valid,pos (deg),pos_lin (deg)");
  // The simulated fleet applies no table, so its pos_lin is the identity word.
  const [, , pos, lin] = (lines[1] ?? "").split(",");
  expect(lin).toBe(pos);
});
