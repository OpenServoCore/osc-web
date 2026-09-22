import { expect, type Page } from "@playwright/test";

/** Lands on the home page with a simulated fleet of `ids` already scanned. */
export async function gotoSim(page: Page, ids: number[]): Promise<void> {
  await page.goto(`/?sim=${ids.join(",")}`);
  await expect(page.getByRole("button", { name: /^Connected/ })).toBeVisible();
}
