import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { gotoSim, setSpeed } from "./helpers";

const SUMMARY = /^(\d+) frames, (\d+) samples, (complete|incomplete), \d+ garble, \d+ statuses/;

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

// The simulated fleet boots at the factory 1 M.
test("at 1 M a capture is refused: TEL streams at 3 M only", async ({ page }) => {
  await openStream(page);
  await expect(page.getByText("chunks 0x0228+12 - tel_count 120")).toBeVisible();
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await expect(
    page.getByText(
      "TEL streams at 3 Mbaud only: raise the bus speed to 3 M, and use a short cable with good contacts.",
    ),
  ).toBeVisible();
  await expect(page.getByLabel("Capture summary")).toHaveCount(0);
});

test("at 3 M the default six fill the summary and download matching CSV rows", async ({ page }) => {
  await openStream(page, "3 M");
  await expect(page.getByText("chunks 0x0228+12 - tel_count 120")).toBeVisible();
  const { frames, samples } = await capture(page);
  expect(frames).toBeGreaterThan(0);
  expect(samples).toBeGreaterThan(0);
  await expect(page.getByRole("region", { name: "deg | %, mA, V" })).toBeVisible();
  const lines = await downloadCsv(page);
  expect(lines[0]).toBe(
    "sample,valid,duty_ticks (%),pos (deg),current_trough (mA),current_raw (mA),vmotor_a (V),vmotor_b (V)",
  );
  expect(lines.length - 1).toBe(samples);
  const rows = lines.slice(1).map((l) => l.split(","));
  for (const line of lines.slice(1)) {
    expect(line).toMatch(/^\d+,[01],-?\d+\.\d,-?\d+\.\d,-?\d+,-?\d+,-?\d+\.\d\d,-?\d+\.\d\d$/);
  }
  const duty = rows.map((r) => Number(r[2]));
  expect(duty.every((d) => Math.abs(d) <= 100)).toBe(true);
  expect(duty.some((d) => d !== 0)).toBe(true);
  // A row at zero duty drove no window, so its current is not fresh.
  expect(rows.filter((r) => Number(r[2]) === 0).every((r) => r[1] === "0")).toBe(true);
});

test("presets and ticked fields drive the chunks, the burst and the CSV header", async ({
  page,
}) => {
  await openStream(page, "3 M");
  await page.getByRole("button", { name: "Raw frame" }).click();
  await expect(page.getByText("chunks 0x022a+12 - tel_count 120")).toBeVisible();
  await page.getByRole("button", { name: "Ident four" }).click();
  await expect(page.getByText("chunks 0x0224+8 - tel_count 120")).toBeVisible();
  // An estimate rides in the second chunk, copied after the medium step.
  await page.getByRole("checkbox", { name: "Velocity estimate", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Samples" }).fill("40");
  await expect(page.getByText("chunks 0x0224+8, 0x0248+4 - tel_count 40")).toBeVisible();
  const { samples } = await capture(page);
  expect(samples).toBeGreaterThan(0);
  expect(samples).toBeLessThanOrEqual(40);
  const lines = await downloadCsv(page);
  expect(lines[0]).toBe(
    "sample,valid,i_tick_counts (mA),vdiff_counts (V),duty_ticks (%),pos (deg),omega_hat_cps (deg/s)",
  );
  expect(lines.length - 1).toBe(samples);
  expect(lines[1]).toMatch(/^0,[01],-?\d+,-?\d+\.\d\d,-?\d+\.\d,-?\d+\.\d,-?\d+$/);
});

test("a selection two chunks cannot cover says so and cannot be captured", async ({ page }) => {
  await openStream(page, "3 M");
  await page.getByRole("button", { name: "Ident four" }).click();
  for (const name of ["NTC raw", "Sample tick"]) {
    await page.getByRole("checkbox", { name, exact: true }).click();
  }
  await expect(
    page.getByText(
      "these fields need 22 B rows; a row copies at most 12 B in at most 2 runs of the table. Untick some fields or capture them over two bursts.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Capture", exact: true })).toBeDisabled();
});
