import { expect, test, type Locator, type Page } from "@playwright/test";
import { gotoSim } from "./helpers";

// The simulated servos run the production stacks over a bus with a config
// store behind each of them, so all four actions land for real: SAVE writes
// the store, FACTORY wipes it and reboots the servo onto board defaults.

async function openManage(page: Page, id: number): Promise<Locator> {
  await gotoSim(page, [1, 2]);
  await page.getByRole("button", { name: `ID ${id}` }).click();
  await expect(page.getByRole("heading", { name: `ID ${id}` })).toBeVisible();
  return page.getByRole("region", { name: "Manage" });
}

test("a new id is assigned by serial and the page follows the servo onto it", async ({ page }) => {
  const card = await openManage(page, 2);
  await card.getByRole("spinbutton", { name: "Servo id" }).fill("7");
  await card.getByRole("button", { name: "Assign" }).click();

  await expect(page.getByRole("heading", { name: "ID 7" })).toBeVisible();
  await expect(page.getByRole("button", { name: "ID 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "ID 7" })).toBeVisible();
  await expect(page.getByRole("button", { name: "ID 2" })).toHaveCount(0);
});

test("an id the fleet already answers at is refused", async ({ page }) => {
  const card = await openManage(page, 2);
  await card.getByRole("spinbutton", { name: "Servo id" }).fill("1");
  await expect(card.getByText("ID 1 is taken by another servo.")).toBeVisible();
  await expect(card.getByRole("button", { name: "Assign" })).toBeDisabled();
});

test("Reboot rescans and the servo answers again", async ({ page }) => {
  const card = await openManage(page, 2);
  await card.getByRole("button", { name: "Reboot" }).click();
  await expect(card.getByText("Rebooting .. back in a moment.")).toBeVisible();
  await expect(page.getByRole("button", { name: "ID 2" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "ID 2" })).toBeVisible();
  // The seed is SAVEd like a bench calibration, so the reboot boots it back.
  await expect(
    page.getByRole("region", { name: "Calibration" }).getByText("Calibrated", { exact: true }),
  ).toBeVisible();
});

test("Factory reset runs behind the confirm strip", async ({ page }) => {
  const card = await openManage(page, 2);
  const erase = card.getByRole("button", { name: "Erase" });

  await card.getByRole("button", { name: "Factory reset" }).click();
  await expect(erase).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(erase).toBeHidden();

  await card.getByRole("button", { name: "Factory reset" }).click();
  await card.getByRole("button", { name: "Cancel" }).click();
  await expect(erase).toBeHidden();

  await card.getByRole("button", { name: "Factory reset" }).click();
  await erase.click();
  await expect(erase).toBeHidden();
  await expect(card.getByText("Erased. It comes back as ID 1 at 1 M.")).toBeVisible();
  await expect(page.getByRole("button", { name: "ID 2" })).toBeVisible();
  // Hardware FACTORY erases the calibration image with the config, so the
  // servo comes back reading blank, exactly like a real one.
  await expect(
    page.getByRole("region", { name: "Calibration" }).getByText("Not calibrated"),
  ).toBeVisible();
});

test("Save settings reaches the servo while torque is off", async ({ page }) => {
  const card = await openManage(page, 2);
  const save = card.getByRole("button", { name: "Save settings" });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(card.getByText("Settings saved.")).toBeVisible();
  await expect(page.getByRole("button", { name: "ID 2" })).toBeVisible();
});
