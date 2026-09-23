import { expect, test, type Locator, type Page } from "@playwright/test";
import { openTable, tableRow } from "./helpers";

/** Opens the row's editor and returns the popover. */
async function openEditor(page: Page, name: string): Promise<Locator> {
  await tableRow(page, name).getByRole("button", { expanded: false }).click();
  return page.getByRole("dialog");
}

test("a number edit shows after apply and survives a refresh", async ({ page }) => {
  await openTable(page);
  await page.getByRole("button", { name: /^Identity and bus/ }).click();
  const cell = tableRow(page, "response_deadline_us").getByRole("cell");
  await expect(cell).toHaveText(/^\d+ us$/);
  const next = Number(/^\d+/.exec((await cell.textContent()) ?? "")?.[0]) + 100;
  const editor = await openEditor(page, "response_deadline_us");
  await editor.getByRole("textbox").fill(String(next));
  await editor.getByRole("button", { name: "Apply" }).click();
  await expect(editor).toHaveCount(0);
  await expect(cell).toHaveText(`${next} us`);
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(cell).toHaveText(`${next} us`);
});

test("a bool row flips through the switch", async ({ page }) => {
  await openTable(page);
  const cell = tableRow(page, "openloop_zero_brake").getByRole("cell");
  await expect(cell).toHaveText(/^(On|Off)$/);
  const was = await cell.textContent();
  const editor = await openEditor(page, "openloop_zero_brake");
  await editor.getByRole("switch").click();
  await editor.getByRole("button", { name: "Apply" }).click();
  await expect(cell).toHaveText(was === "On" ? "Off" : "On");
});

test("an enum row picks a variant through the select", async ({ page }) => {
  await openTable(page);
  const cell = tableRow(page, "stall_response").getByRole("cell");
  await expect(cell).toHaveText("Fault");
  const editor = await openEditor(page, "stall_response");
  await editor.getByRole("combobox").click();
  await page.getByRole("option", { name: "Yield" }).click();
  await editor.getByRole("button", { name: "Apply" }).click();
  await expect(cell).toHaveText("Yield");
});

test("Live values moves on its own", async ({ page }) => {
  await openTable(page);
  await page.getByRole("tab", { name: "Live values" }).click();
  // The replayed pot sits at its rail for seconds at a time; the motor
  // current moves every tick.
  const cell = tableRow(page, "current").getByRole("cell");
  await expect(cell).toHaveText(/^\d+$/);
  const first = (await cell.textContent()) ?? "";
  await expect(cell).not.toHaveText(first, { timeout: 5000 });
  await expect(cell).toHaveText(/^\d+$/);
});

test("a Live values edit flashes its row and shows the written value", async ({ page }) => {
  await openTable(page);
  await page.getByRole("tab", { name: "Live values" }).click();
  const row = tableRow(page, "stall_permit");
  const cell = row.getByRole("cell");
  await expect(cell).toHaveText(/^(On|Off)$/);
  const was = await cell.textContent();
  const editor = await openEditor(page, "stall_permit");
  await editor.getByRole("switch").click();
  await editor.getByRole("button", { name: "Apply" }).click();
  await expect(row).toHaveClass(/bg-success-soft/);
  await expect(cell).toHaveText(was === "On" ? "Off" : "On");
});
