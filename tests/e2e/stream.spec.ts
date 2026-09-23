import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { gotoSim } from "./helpers";

const SUMMARY = /^(\d+) frames, (\d+) samples, (complete|incomplete), \d+ garble, \d+ statuses/;

async function openStream(page: Page): Promise<void> {
  await gotoSim(page, [1, 2]);
  await page.getByRole("button", { name: "ID 1" }).click();
  await page.getByRole("link", { name: "Live" }).click();
  // A cold dev server compiles the Live route chunk on this first request.
  await page.getByRole("tab", { name: "Stream" }).click({ timeout: 15_000 });
  // The tick rate arrives with the conversion registers; the sentence needs both.
  await expect(page.getByText(/ samples = [\d.]+ ms at \d+ kHz$/)).toBeVisible();
}

/** Runs a capture and returns the summary's frame and sample counts. */
async function capture(page: Page): Promise<{ frames: number; samples: number }> {
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  const summary = page.getByLabel("Capture summary");
  await expect(summary).toHaveText(SUMMARY);
  const m = SUMMARY.exec((await summary.textContent()) ?? "");
  return { frames: Number(m?.[1]), samples: Number(m?.[2]) };
}

async function downloadCsv(page: Page): Promise<string[]> {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download .csv" }).click(),
  ]);
  const text = await readFile(await download.path(), "utf8");
  expect(download.suggestedFilename()).toMatch(/^burst-id1-.*\.csv$/);
  // The file ends with a newline, so the split leaves one empty string.
  const lines = text.split("\n");
  expect(lines.at(-1)).toBe("");
  return lines.slice(0, -1);
}

// The simulated fleet replays a recorded track at 1 M, where a full-rate burst
// still fits the wire for the default five fields, so the burst comes back
// complete; the assertions only lean on what arrived.
test("a capture with the default fields fills the summary and downloads matching CSV rows", async ({
  page,
}) => {
  await openStream(page);
  await expect(page.getByText("tel_mask 0x03c1 - tel_count 120")).toBeVisible();
  const { frames, samples } = await capture(page);
  expect(frames).toBeGreaterThan(0);
  expect(samples).toBeGreaterThan(0);
  await expect(page.getByRole("region", { name: "deg | mA, V" })).toBeVisible();
  const lines = await downloadCsv(page);
  expect(lines[0]).toBe(
    "sample,valid,pos (deg),current_raw (mA),vmotor_a (V),vmotor_b (V),vbus_raw (V)",
  );
  expect(lines.length - 1).toBe(samples);
  expect(lines[1]).toMatch(/^0,[01],\d+\.\d,-?\d+,-?\d+\.\d\d,-?\d+\.\d\d,\d+\.\d\d$/);
});

test("the field selection and sample count drive the mask, the burst and the CSV header", async ({
  page,
}) => {
  await openStream(page);
  for (const name of ["Current raw", "Motor A", "Motor B", "Bus raw"]) {
    await page.getByRole("checkbox", { name, exact: true }).click();
  }
  await page.getByRole("checkbox", { name: "Current", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Samples" }).fill("40");
  await expect(page.getByText("tel_mask 0x0003 - tel_count 40")).toBeVisible();
  const { samples } = await capture(page);
  expect(samples).toBeGreaterThan(0);
  expect(samples).toBeLessThanOrEqual(40);
  const lines = await downloadCsv(page);
  expect(lines[0]).toBe("sample,valid,pos (deg),current (mA)");
  expect(lines.length - 1).toBe(samples);
});
