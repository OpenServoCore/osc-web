import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { gotoSim } from "./helpers";

const SUMMARY = /^(\d+) frames, (\d+) samples, (complete|incomplete), \d+ garble, \d+ statuses/;

/** Migrates the simulated fleet from its factory 1 M through the connection popover. */
async function setSpeed(page: Page, speed: string): Promise<void> {
  await page.getByRole("button", { name: /^Connected/ }).click();
  const popover = page.getByRole("dialog");
  await popover.getByRole("combobox", { name: "Speed" }).click();
  await page.getByRole("option", { name: speed }).click();
  await popover.getByRole("button", { name: "Apply" }).click();
  await popover.getByRole("button", { name: "Change speed" }).click();
  await expect(page.getByRole("button", { name: `Connected at ${speed}` })).toBeVisible();
  await page.keyboard.press("Escape");
}

async function openStream(page: Page, speed?: string): Promise<void> {
  await gotoSim(page, [1, 2]);
  if (speed !== undefined) await setSpeed(page, speed);
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

// The default five fields pack to 8 B rows: past the 4 B the servo streams at
// its factory 1 M, inside 3 M's limit.
test("at 1 M the default fields are refused with the servo's row limit", async ({ page }) => {
  await openStream(page);
  await expect(page.getByText("tel_mask 0x03c1 - tel_count 120")).toBeVisible();
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await expect(
    page.getByText(
      "these fields pack to 8 B rows; the servo streams rows of at most 4 B at 1 M. Raise the speed or capture the fields over two bursts.",
    ),
  ).toBeVisible();
  await expect(page.getByLabel("Capture summary")).toHaveCount(0);
});

test("at 3 M a capture with the default fields fills the summary and downloads matching CSV rows", async ({
  page,
}) => {
  await openStream(page, "3 M");
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

test("duty streams as a percent of the servo's PWM period", async ({ page }) => {
  await openStream(page);
  for (const name of ["Current raw", "Motor A", "Motor B", "Bus raw"]) {
    await page.getByRole("checkbox", { name, exact: true }).click();
  }
  await page.getByRole("checkbox", { name: "Duty", exact: true }).click();
  await expect(page.getByText("tel_mask 0x0009 - tel_count 120")).toBeVisible();
  const { samples } = await capture(page);
  expect(samples).toBeGreaterThan(0);
  const lines = await downloadCsv(page);
  expect(lines[0]).toBe("sample,valid,pos (deg),duty (%)");
  const duty = lines.slice(1).map((l) => Number(l.split(",")[3]));
  expect(duty.every((d) => Math.abs(d) <= 100)).toBe(true);
  expect(duty.some((d) => d !== 0)).toBe(true);
});
