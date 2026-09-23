import { expect, test } from "@playwright/test";
import { openTable, tableRow as row } from "./helpers";

test("the Settings tab reads the id row", async ({ page }) => {
  await openTable(page);
  await page.getByRole("button", { name: /^Identity and bus/ }).click();
  await expect(row(page, "id").getByRole("cell")).toHaveText(/^1\b/);
});

test("the Board tab reads the sim's shunt resistance", async ({ page }) => {
  await openTable(page);
  await page.getByRole("tab", { name: "Board" }).click();
  await expect(row(page, "shunt_r_mohm").getByRole("cell")).toHaveText("60 mOhm");
});

test("the Live values tab reads an integer position", async ({ page }) => {
  await openTable(page);
  await page.getByRole("tab", { name: "Live values" }).click();
  await expect(row(page, "pos").getByRole("cell")).toHaveText(/^\d+$/);
});
