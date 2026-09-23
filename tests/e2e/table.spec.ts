import { expect, test, type Locator, type Page } from "@playwright/test";
import { gotoSim } from "./helpers";

async function openTable(page: Page): Promise<void> {
  await gotoSim(page, [1, 2]);
  await page.getByRole("button", { name: "ID 1" }).click();
  await page.getByRole("link", { name: "Control table" }).click();
  // A cold dev server compiles the route chunk on this first request.
  await expect(page.getByRole("tab", { name: "Settings" })).toBeVisible({ timeout: 15_000 });
}

/** The row whose register name is `name`. */
function row(page: Page, name: string): Locator {
  return page.getByRole("row").filter({ has: page.getByText(name, { exact: true }) });
}

test("the Settings tab reads the id row", async ({ page }) => {
  await openTable(page);
  await page.getByRole("button", { name: /^Identity and bus/ }).click();
  await expect(row(page, "id").getByRole("cell")).toHaveText(/^1\b/);
});

test("the Board tab reads the sim's shunt resistance", async ({ page }) => {
  await openTable(page);
  await page.getByRole("tab", { name: "Board" }).click();
  await expect(row(page, "shunt_r_mohm").getByRole("cell")).toHaveText("33 mOhm");
});

test("the Live values tab reads an integer position", async ({ page }) => {
  await openTable(page);
  await page.getByRole("tab", { name: "Live values" }).click();
  await expect(row(page, "pos").getByRole("cell")).toHaveText(/^\d+$/);
});
