import { expect, test } from "@playwright/test";
import { gotoSim } from "./helpers";

const servoNav = ["Servo", "Control table", "Live"];

test("a simulated fleet lists its servos and reads connected", async ({ page }) => {
  await gotoSim(page, [1, 2]);
  await expect(page.getByRole("button", { name: "ID 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "ID 2" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Connected/ })).toBeVisible();
  for (const name of servoNav) {
    await expect(page.getByRole("link", { name })).toBeDisabled();
  }
});

test("without ?sim the servo pages are disabled and nothing is connected", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Not connected" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeEnabled();
  for (const name of servoNav) {
    await expect(page.getByRole("link", { name })).toBeDisabled();
  }
});

test("?nousb renders the unsupported card alone", async ({ page }) => {
  await page.goto("/?nousb");
  await expect(page.getByText("This browser cannot talk to USB")).toBeVisible();
  await expect(page.getByRole("link", { name: "Dashboard" })).toHaveCount(0);
});
