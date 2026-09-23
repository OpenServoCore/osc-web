import { expect, test } from "@playwright/test";

const READOUT = /^-?\d+(\.\d+)? deg$/;

test("the debug panel reports a clean bus while the dashboard polls", async ({ page }) => {
  await page.goto("/?sim=1,2&debug");
  await expect(page.getByRole("button", { name: /^Connected/ })).toBeVisible();
  const panel = page.getByRole("region", { name: "Bus statistics" });
  await expect(panel).toBeVisible();
  for (const id of [1, 2]) {
    const card = page.getByRole("link", { name: new RegExp(`^ID ${id}\\b`) });
    await expect(card.getByText(READOUT)).toBeVisible();
  }
  await page.waitForTimeout(2000);
  await expect(panel.locator('dt:text-is("stalled") + dd')).toHaveText("0");
  await expect(panel.locator('dt:text-is("errors") + dd')).toHaveText("0");
  await expect(panel.locator('dt:text-is("exchanges") + dd')).not.toHaveText("0");
  for (const id of [1, 2]) {
    const card = page.getByRole("link", { name: new RegExp(`^ID ${id}\\b`) });
    await expect(card.getByText(READOUT)).toBeVisible();
  }
});

test("without ?debug the panel stays out of the way", async ({ page }) => {
  await page.goto("/?sim=1");
  await expect(page.getByRole("button", { name: /^Connected/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Bus statistics" })).toHaveCount(0);
});
