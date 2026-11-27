import { expect, test, type Page } from "@playwright/test";

const FRESH = "Settings not identified (defaults): run an identification.";
const LIMITS = "Closed loop refused: the current cap or the speed ceiling is unset.";
const NOT_SAVED = "Changes not saved: a reboot loses them.";

/** ID 1 seeded, ID 2 factory-fresh. */
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

test("a factory-fresh servo warns of its refusal on its card and of each case on its page; a seeded one does not", async ({
  page,
}) => {
  await gotoFleet(page);
  const fresh = page.getByRole("link", { name: /^ID 2\b/ });
  await expect(fresh.getByText(LIMITS)).toBeVisible();
  const seeded = page.getByRole("link", { name: /^ID 1\b/ });
  await expect(seeded.getByText("No faults")).toBeVisible();

  await openServo(page, 2);
  const banner = page.getByRole("status", { name: "Stored state" });
  await expect(banner).toContainText(LIMITS);
  await expect(banner).toContainText(FRESH);
  await expect(banner).toContainText(
    "status_flags 0x06: CONFIG_DEFAULTS | CALIB_DEFAULTS, refused_modes 0x0e",
  );
  await expect(
    page.getByRole("region", { name: "Calibration" }).getByText("Not calibrated"),
  ).toBeVisible();

  await openServo(page, 1);
  await expect(page.getByRole("status", { name: "Stored state" })).toHaveCount(0);
});

test("the Live page offers a fresh servo open loop only, with the belt's reason", async ({
  page,
}) => {
  await gotoFleet(page);
  await openServo(page, 2);
  await openLive(page);
  await expect(page.getByLabel("Mode gate")).toHaveText(new RegExp(`^${LIMITS}`));
  const mode = page.getByRole("combobox", { name: "Mode" });
  // The app's Position preference is not pushed onto a servo that would refuse it.
  await expect(mode).toHaveText("Open loop");
  await mode.click();
  for (const name of ["Current", "Velocity", "Position"]) {
    await expect(page.getByRole("option", { name })).toHaveAttribute("data-disabled", "");
  }
});

test("a seeded servo's Live page is not gated", async ({ page }) => {
  await gotoFleet(page);
  await openServo(page, 1);
  await openLive(page);
  await expect(page.getByRole("combobox", { name: "Mode" })).toHaveText("Position");
  await expect(page.getByLabel("Mode gate")).toHaveCount(0);
});

test("a calibration edit runs as written and warns only that it is not saved", async ({ page }) => {
  await gotoFleet(page);
  await openServo(page, 1);
  const card = page.getByRole("region", { name: "Calibration" });
  await card.getByRole("group", { name: "Sensor highest" }).getByRole("button").click();
  await page.getByRole("textbox").fill("4000");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(
    card
      .getByRole("group", { name: "Sensor highest" })
      .getByRole("button", { name: "4000 counts" }),
  ).toBeVisible();
  const banner = page.getByRole("status", { name: "Stored state" });
  await expect(banner).toContainText(NOT_SAVED);
  await expect(banner).not.toContainText(FRESH);
  await expect(banner).not.toContainText("Closed loop refused");
  await expect(banner).toContainText("status_flags 0x01, refused_modes 0x00");
});
