import { expect, test } from "@playwright/test";
import { gotoSim } from "./helpers";

const UID = /^[0-9a-f]{32}$/;
const UID_1 = "c94b8419d1092aec87de5fd151ce290f";
const UID_2 = "30634f42dde2095340c8d84f67f28244";

test("a simulated fleet of two discovers as ids 1 and 2", async ({ page }) => {
  await gotoSim(page, [1, 2]);

  const rows = page.getByRole("row").filter({ has: page.getByRole("radio") });
  await expect(rows).toHaveCount(2);
  await expect(page.getByRole("cell", { name: "1", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "2", exact: true })).toBeVisible();

  const uids = await page.getByText(UID).allTextContents();
  expect(uids).toHaveLength(2);
  expect(uids[0]).not.toBe(uids[1]);

  const row1 = rows.filter({ hasText: UID_1 });
  const row2 = rows.filter({ hasText: UID_2 });
  await expect(row1.getByRole("cell", { name: "1", exact: true })).toBeVisible();
  await expect(row2.getByRole("cell", { name: "2", exact: true })).toBeVisible();
  for (const row of [row1, row2]) {
    await expect(row.getByText("0x0101")).toBeVisible();
    await expect(row.getByText("0.1.0")).toBeVisible();
  }
});

test("without ?sim the page offers to connect and lists nothing", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Connect adapter" })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
});
