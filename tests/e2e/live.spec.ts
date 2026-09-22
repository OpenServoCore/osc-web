import { expect, test, type Page } from "@playwright/test";
import { gotoSim } from "./helpers";

const READOUT = /^-?\d+(\.\d+)? \S+$/;

async function openLive(page: Page): Promise<void> {
  await gotoSim(page, [1, 2]);
  await page.getByRole("button", { name: "ID 1" }).click();
  await page.getByRole("link", { name: "Live" }).click();
  // A cold dev server compiles the Live route chunk on this first request.
  await expect(page.getByRole("region", { name: /^Motion/ })).toBeVisible({ timeout: 15_000 });
}

test("the position readout is a number with a unit and moves with the replayed track", async ({
  page,
}) => {
  await openLive(page);
  const position = page.getByLabel("Position value");
  await expect(position).toHaveText(READOUT);
  // The recorded pot sits at its rail most of the loop, so the second reading
  // is whichever comes first that differs, not one a fixed delay later.
  const first = (await position.textContent()) ?? "";
  await expect(position).not.toHaveText(first, { timeout: 5000 });
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
