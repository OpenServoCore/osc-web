import { expect, test, type Page } from "@playwright/test";
import { gotoSim } from "./helpers";

// The simulated fleet boots calibrated, so the position family reads degrees.
const READOUT = /^-?\d+(\.\d+)? deg$/;

async function openLive(page: Page): Promise<void> {
  await gotoSim(page, [1, 2]);
  await page.getByRole("button", { name: "ID 1" }).click();
  // The servo page proves the selection landed: leaving for Live while that
  // navigation is still compiling on a cold dev server races the two.
  await expect(page.getByRole("heading", { name: "ID 1" })).toBeVisible();
  await page.getByRole("link", { name: "Live" }).click();
  // A cold dev server compiles the Live route chunk on this first request.
  await expect(page.getByRole("region", { name: /^Motion/ })).toBeVisible({ timeout: 15_000 });
  // Readouts are placeholders until the poll delivers its first sample.
  await expect(page.getByText("waiting for data")).toHaveCount(0);
}

test("the position readout is a number with a unit and the replayed track keeps moving", async ({
  page,
}) => {
  const position = page.getByLabel("Position value");
  await openLive(page);
  await expect(position).toHaveText(READOUT);
  // The recorded pot rests at a rail for seconds at a time, so movement is
  // read off the shunt instead, which is noisy on every tick.
  const current = page.getByLabel("Current value");
  const first = (await current.textContent()) ?? "";
  await expect(current).not.toHaveText(first, { timeout: 5000 });
  await expect(position).toHaveText(READOUT);
});

test("the current readout is in milliamps", async ({ page }) => {
  await openLive(page);
  await expect(page.getByLabel("Current value")).toHaveText(/ mA$/);
});

test("the temperature panel is absent until its series is switched on", async ({ page }) => {
  await openLive(page);
  await expect(page.getByRole("region", { name: /^Temperature/ })).toHaveCount(0);
  await page.getByRole("switch", { name: "Temperature" }).click();
  await expect(page.getByRole("region", { name: /^Temperature/ })).toBeVisible();
});
