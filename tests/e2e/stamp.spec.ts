import { expect, test } from "@playwright/test";
import { openTable, tableRow } from "./helpers";

test("a covered edit says why closed loop went off, and save and stamp leaves the data clean", async ({
  page,
}) => {
  await openTable(page);
  await page.getByRole("button", { name: /^Control loops/ }).click();
  const row = tableRow(page, "velocity_limit_cps");
  await row.evaluate((el) => {
    el.scrollIntoView({ block: "end" });
  });
  await row.getByRole("button", { expanded: false }).click();
  const editor = page.getByRole("dialog");
  const input = editor.getByRole("textbox");
  await expect(input).toHaveValue(/^\d+$/);
  await input.fill(String(Number(await input.inputValue()) - 100));
  await editor.getByRole("button", { name: "Apply" }).click();
  await expect(editor).toHaveCount(0);

  const notice = page.getByRole("status", { name: "Stamp" });
  await expect(notice).toContainText("Closed loop is off: the stamp no longer matches.");
  const viewport = page.viewportSize();
  // Scroll offsets are whole pixels, so a scrolled-to box can sit a fraction above y = 0.
  await expect
    .poll(async () => {
      const box = await notice.boundingBox();
      return (
        box !== null &&
        viewport !== null &&
        Math.round(box.y) >= 0 &&
        Math.round(box.y + box.height) <= viewport.height
      );
    })
    .toBe(true);
  await notice.getByRole("button", { name: "Save and stamp" }).click();
  await expect(notice).toHaveCount(0);

  await page.getByRole("button", { name: "ID 1" }).click();
  await expect(page.getByRole("heading", { name: "ID 1" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Plant stamp" })).toContainText(
    "Stamped: the calibration",
  );
  await expect(page.getByRole("status", { name: "Data state" })).toHaveCount(0);
  const health = page.getByRole("region", { name: "Health" });
  await expect(health.getByText("No faults.")).toBeVisible();
  await expect(health.getByText(/^Unsaved changes/)).toHaveCount(0);
});
