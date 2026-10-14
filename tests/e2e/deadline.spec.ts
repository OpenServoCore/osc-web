import { expect, test } from "@playwright/test";
import { tableRow } from "./helpers";

test("connect rewrites a servo holding another response deadline and leaves a matching one unwritten", async ({
  page,
}) => {
  await page.goto("/?sim=1,2&deadline=2:400");
  await expect(page.getByRole("button", { name: /^Connected/ })).toBeVisible();
  await expect(
    page.getByRole("link", { name: /^ID 2\b/ }).getByText("Unsaved changes"),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /^ID 1\b/ }).getByText("No faults")).toBeVisible();

  await page.getByRole("button", { name: "ID 2" }).click();
  await page.getByRole("link", { name: "Control table" }).click();
  await expect(page.getByRole("tab", { name: "Settings" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /^Identity and bus/ }).click();
  await expect(tableRow(page, "response_deadline_us").getByRole("cell")).toHaveText("1000 us");
});
