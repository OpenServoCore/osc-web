import { expect, test, type Page } from "@playwright/test";
import { gotoSim, openTable, tableRow } from "./helpers";

// The fake servo publishes the winding estimate as the kernel would, and
// CONFIG carries the firmware's default cutoff.
const CUTOFF = "Cutoff at 90.0 °C";

function winding(page: Page) {
  return page.getByRole("region", { name: "Health" }).getByRole("group", { name: "Winding" });
}

test("the health block reads the winding and the board in C beside the CONFIG cutoff", async ({
  page,
}) => {
  await gotoSim(page, [1, 2]);
  await page.getByRole("button", { name: "ID 1" }).click();
  await expect(page.getByRole("heading", { name: "ID 1" })).toBeVisible();
  const row = winding(page);
  await expect(row.getByLabel("Winding temperature")).toHaveText(/^-?\d+\.\d °C$/);
  await expect(row.getByLabel("Board temperature")).toHaveText(/^Board -?\d+\.\d °C$/);
  await expect(row.getByLabel("Cutoff")).toHaveText(CUTOFF);
});

test("a cutoff written to CONFIG is the cutoff the health block reads", async ({ page }) => {
  await openTable(page);
  await page.getByRole("button", { name: /^Thermal/ }).click();
  await tableRow(page, "cutoff_cc").getByRole("button", { expanded: false }).click();
  const editor = page.getByRole("dialog");
  await editor.getByRole("textbox").fill("8550");
  await editor.getByRole("button", { name: "Apply" }).click();
  await expect(editor).toHaveCount(0);

  await page.getByRole("link", { name: "Servo" }).click();
  await expect(winding(page).getByLabel("Cutoff")).toHaveText("Cutoff at 85.5 °C");
});
