import { expect, type Page } from "@playwright/test";

/** Lands on the connect page already attached to a simulated fleet of `ids`. */
export async function gotoSim(page: Page, ids: number[]): Promise<void> {
  await page.goto(`/?sim=${ids.join(",")}`);
  await expect(page.getByRole("button", { name: "Discover" })).toBeVisible();
}
