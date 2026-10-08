import { expect, test, type Page } from "@playwright/test";
import { gotoSim, openTable, tableRow } from "./helpers";

// The fake servo has no kernel: its thermometer registers hold what the
// table boots with, and CONFIG carries the firmware's default thresholds.
const THRESHOLDS = "Derate at 80.0 C, cutoff at 100.0 C, recover at 90.0 C";

function winding(page: Page) {
  return page.getByRole("region", { name: "Health" }).getByRole("group", { name: "Winding" });
}

test("the health block reads the winding and the board in C beside the CONFIG thresholds", async ({
  page,
}) => {
  await gotoSim(page, [1, 2]);
  await page.getByRole("button", { name: "ID 1" }).click();
  await expect(page.getByRole("heading", { name: "ID 1" })).toBeVisible();
  const row = winding(page);
  await expect(row.getByLabel("Winding temperature")).toHaveText(/^-?\d+\.\d C$/);
  await expect(row.getByLabel("Board temperature")).toHaveText(/^Board -?\d+\.\d C$/);
  await expect(row.getByLabel("Thresholds")).toHaveText(THRESHOLDS);
  await expect(row.getByText("derating")).toHaveCount(0);
});

test("a derate start under the winding reads derating with the folded limit", async ({ page }) => {
  await openTable(page);
  await page.getByRole("button", { name: /^Thermal/ }).click();
  await tableRow(page, "derate_start_cc").getByRole("button", { expanded: false }).click();
  const editor = page.getByRole("dialog");
  await editor.getByRole("textbox").fill("-150");
  await editor.getByRole("button", { name: "Apply" }).click();
  await expect(editor).toHaveCount(0);

  await page.getByRole("link", { name: "Servo" }).click();
  const row = winding(page);
  await expect(row.getByLabel("Thresholds")).toHaveText(
    "Derate at -1.5 C, cutoff at 100.0 C, recover at 90.0 C",
  );
  await expect(row.getByText("derating", { exact: true })).toBeVisible();
  await expect(row.getByLabel("Derated limit")).toHaveText(/^limit \d+ mA of \d+ mA$/);
});
