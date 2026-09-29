import { expect, test, type Page } from "@playwright/test";

const FRESH = "Closed loop is off: this servo has never been set up.";

/** ID 1 stamped, ID 2 factory-fresh. */
async function gotoFleet(page: Page): Promise<void> {
  await page.goto("/?sim=1,2&virgin=2");
  await expect(page.getByRole("button", { name: /^Connected/ })).toBeVisible();
}

async function openServo(page: Page, id: number): Promise<void> {
  await page.getByRole("button", { name: `ID ${id}` }).click();
  await expect(page.getByRole("heading", { name: `ID ${id}` })).toBeVisible();
}

async function openLive(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Live" }).click();
  await expect(page.getByRole("region", { name: /^Motion/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("combobox", { name: "Mode" })).toBeEnabled();
}

test("a factory-fresh servo carries the banner on its card and page; a stamped one does not", async ({
  page,
}) => {
  await gotoFleet(page);
  const fresh = page.getByRole("link", { name: /^ID 2\b/ });
  await expect(fresh.getByText(FRESH)).toBeVisible();
  const stamped = page.getByRole("link", { name: /^ID 1\b/ });
  await expect(stamped.getByText("No faults")).toBeVisible();

  await openServo(page, 2);
  const banner = page.getByRole("status", { name: "Data state" });
  await expect(banner).toContainText(FRESH);
  await expect(banner).toContainText(
    "data_flags 0x35: CONFIG_VIRGIN | CALIB_VIRGIN | STAMP_MISMATCH | PLANT_UNSET",
  );
  await expect(banner).toContainText("the motor has not been identified");
  await expect(
    page.getByRole("region", { name: "Calibration" }).getByText("Not calibrated"),
  ).toBeVisible();
  const stamp = page.getByRole("group", { name: "Plant stamp" });
  await expect(stamp).toContainText("Never stamped");
  await expect(stamp).toContainText("plant_stamp 0x0b2 = 0x0000");

  await openServo(page, 1);
  await expect(page.getByRole("status", { name: "Data state" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Plant stamp" })).toContainText(
    "Stamped: the calibration",
  );
});

test("the Live page offers a fresh servo open loop and current only, with the reason", async ({
  page,
}) => {
  await gotoFleet(page);
  await openServo(page, 2);
  await openLive(page);
  await expect(page.getByLabel("Mode gate")).toHaveText(new RegExp(`^${FRESH}`));
  const mode = page.getByRole("combobox", { name: "Mode" });
  // The app's Position preference is not pushed onto a servo that would refuse it.
  await expect(mode).toHaveText("Open loop");
  await mode.click();
  await expect(page.getByRole("option", { name: "Velocity" })).toHaveAttribute("data-disabled", "");
  await expect(page.getByRole("option", { name: "Position" })).toHaveAttribute("data-disabled", "");
  await page.getByRole("option", { name: "Current" }).click();
  await expect(mode).toHaveText("Current");
  await expect(page.getByLabel("Goal readout")).toHaveText(/ mA$/);
});

test("a stamped servo's Live page is not gated", async ({ page }) => {
  await gotoFleet(page);
  await openServo(page, 1);
  await openLive(page);
  await expect(page.getByRole("combobox", { name: "Mode" })).toHaveText("Position");
  await expect(page.getByLabel("Mode gate")).toHaveCount(0);
});

test("a calibration edit on a stamped servo marks the set changed until it is restamped", async ({
  page,
}) => {
  await gotoFleet(page);
  await openServo(page, 1);
  const card = page.getByRole("region", { name: "Calibration" });
  await expect(page.getByRole("group", { name: "Plant stamp" })).toContainText(
    "Stamped: the calibration",
  );
  await card.getByRole("group", { name: "Sensor highest" }).getByRole("button").click();
  await page.getByRole("textbox").fill("4000");
  await page.getByRole("button", { name: "Apply" }).click();
  const banner = page.getByRole("status", { name: "Data state" });
  await expect(banner).toContainText("the pot table and the identified values are not one set");
  await expect(page.getByRole("group", { name: "Plant stamp" })).toContainText(
    "Changed since it was stamped",
  );
});
