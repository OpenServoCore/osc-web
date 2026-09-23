import { expect, type Locator, type Page } from "@playwright/test";

/** Lands on the home page with a simulated fleet of `ids` already scanned. */
export async function gotoSim(page: Page, ids: number[]): Promise<void> {
  await page.goto(`/?sim=${ids.join(",")}`);
  await expect(page.getByRole("button", { name: /^Connected/ })).toBeVisible();
}

/** Selects ID 1 of a simulated fleet of 1 and 2 and opens the control table. */
export async function openTable(page: Page): Promise<void> {
  await gotoSim(page, [1, 2]);
  await page.getByRole("button", { name: "ID 1" }).click();
  await page.getByRole("link", { name: "Control table" }).click();
  // A cold dev server compiles the route chunk on this first request.
  await expect(page.getByRole("tab", { name: "Settings" })).toBeVisible({ timeout: 15_000 });
}

/** The control table row whose register name is `name`. */
export function tableRow(page: Page, name: string): Locator {
  return page.getByRole("row").filter({ has: page.getByText(name, { exact: true }) });
}
