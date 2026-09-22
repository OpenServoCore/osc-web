import { expect, type Page, test } from "@playwright/test";
import { gotoSim } from "./helpers";

function openPopover(page: Page) {
  return page.getByRole("button", { name: /^Connected/ }).click();
}

test("in sim mode the popover shows the adapter connected", async ({ page }) => {
  await gotoSim(page, [1, 2]);
  await openPopover(page);
  const popover = page.getByRole("dialog");
  await expect(popover.getByText("Simulated adapter")).toBeVisible();
  await expect(popover.getByText("connected", { exact: true })).toBeVisible();
  await expect(popover.getByText("2 servos answering at 1 M")).toBeVisible();
});

test("the 5V switch flips through the adapter", async ({ page }) => {
  await gotoSim(page, [1, 2]);
  await openPopover(page);
  const rail = page.getByRole("dialog").getByRole("switch", { name: "5V servo" });
  const before = await rail.isChecked();
  await rail.click();
  await expect(rail).toBeChecked({ checked: !before });
});

test("a speed change through Apply and the confirm strip migrates the fleet", async ({ page }) => {
  await gotoSim(page, [1, 2]);
  await openPopover(page);
  const popover = page.getByRole("dialog");
  await popover.getByRole("combobox", { name: "Speed" }).click();
  await page.getByRole("option", { name: "3 M" }).click();
  await popover.getByRole("button", { name: "Apply" }).click();
  await popover.getByRole("button", { name: "Change speed" }).click();
  await expect(page.getByRole("button", { name: "Connected at 3 M" })).toBeVisible();
  await expect(popover.getByText("2 servos answering at 3 M")).toBeVisible();
  await expect(page.getByRole("button", { name: "ID 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "ID 2" })).toBeVisible();
});

test("the sim flag survives navigation so a reconnect stays simulated", async ({ page }) => {
  await gotoSim(page, [1, 2]);
  await page.getByRole("button", { name: "ID 1" }).click();
  await expect(page).toHaveURL(/\/servo\?sim=/);
  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page).toHaveURL(/\/\?sim=/);
  await openPopover(page);
  const popover = page.getByRole("dialog");
  await popover.getByRole("button", { name: "Disconnect" }).click();
  await popover.getByRole("button", { name: "Connect adapter" }).click();
  await expect(page.getByRole("button", { name: /^Connected/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "ID 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "ID 2" })).toBeVisible();
});

test("without ?sim the popover opens on boot offering to connect", async ({ page }) => {
  await page.goto("/");
  const popover = page.getByRole("dialog");
  await expect(popover.getByText("osc-adapter")).toBeVisible();
  await expect(popover.getByRole("button", { name: "Connect adapter" })).toBeVisible();
});
