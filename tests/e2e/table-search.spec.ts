import { expect, test, type Page } from "@playwright/test";
import { openTable, tableRow as row } from "./helpers";

async function search(page: Page, query: string): Promise<void> {
  await page.getByRole("button", { name: "Search the table" }).click();
  await page.getByPlaceholder("Search the table").fill(query);
}

test("a label search lists the hit and Enter lands on its row", async ({ page }) => {
  await openTable(page);
  await search(page, "deadline");
  const hit = page.getByRole("option");
  await expect(hit).toHaveCount(1);
  await expect(hit).toContainText("response_deadline_us 0x012");
  await expect(hit).toContainText("Settings / Identity and bus");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "Settings" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  // Identity and bus starts collapsed, so a visible row means the jump expanded it.
  const cell = row(page, "response_deadline_us").getByRole("cell");
  await expect(cell).toBeVisible();
  await expect(cell).toHaveText(/^\d+ us$/);
});

test("an address search lists the field at that address", async ({ page }) => {
  await openTable(page);
  await search(page, "0x020");
  const hit = page.getByRole("option");
  await expect(hit).toHaveCount(1);
  await expect(hit).toContainText("pos_min_phys_counts 0x020");
  await expect(hit).toContainText("Settings / Motion limits");
});

test("a query nothing matches says so", async ({ page }) => {
  await openTable(page);
  await search(page, "zzz");
  await expect(page.getByText("Nothing matches.")).toBeVisible();
  await expect(page.getByRole("option")).toHaveCount(0);
});
