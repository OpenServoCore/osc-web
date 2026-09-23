import { expect, test, type Page } from "@playwright/test";
import { gotoSim } from "./helpers";

async function openLive(page: Page): Promise<void> {
  await gotoSim(page, [1, 2]);
  await page.getByRole("button", { name: "ID 1" }).click();
  await page.getByRole("link", { name: "Live" }).click();
  // A cold dev server compiles the Live route chunk on this first request.
  await expect(page.getByRole("region", { name: /^Motion/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("combobox", { name: "Mode" })).toBeEnabled();
}

async function pickMode(page: Page, mode: string): Promise<void> {
  await page.getByRole("combobox", { name: "Mode" }).click();
  await page.getByRole("option", { name: mode }).click();
  await expect(page.getByRole("combobox", { name: "Mode" })).toHaveText(mode);
}

async function setGoal(page: Page, value: string): Promise<void> {
  const input = page.getByRole("spinbutton", { name: "Goal" });
  await input.fill(value);
  await input.press("Enter");
}

test("the simulated servo boots in open loop, with the warning and the duty readouts", async ({
  page,
}) => {
  await openLive(page);
  await expect(page.getByRole("combobox", { name: "Mode" })).toHaveText("Open loop");
  await expect(page.getByRole("alert")).toContainText("Open loop can strip the gears");
  await expect(page.getByLabel("Goal readout")).toHaveText(/%$/);
  await expect(page.getByLabel("Commanded duty value")).toHaveText(/^-?\d+\.\d %$/);
  await expect(page.getByLabel("Applied duty value")).toHaveText(/^-?\d+\.\d %$/);
  await expect(page.getByLabel("Goal value")).toHaveCount(0);
});

test("each mode shows its own goal control and the warning is open loop only", async ({ page }) => {
  await openLive(page);
  await pickMode(page, "Current");
  await expect(page.getByLabel("Goal readout")).toHaveText(/ mA$/);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByLabel("Commanded duty value")).toHaveCount(0);
  await pickMode(page, "Velocity");
  await expect(page.getByLabel("Goal readout")).toHaveText(/ counts\/s$/);
  await pickMode(page, "Position");
  await expect(page.getByLabel("Goal readout")).toHaveText(/ counts$/);
  await pickMode(page, "Open loop");
  await expect(page.getByLabel("Goal readout")).toHaveText(/ %$/);
  await expect(page.getByRole("alert")).toBeVisible();
});

test("a velocity goal reads back into the Motion goal readout in the mode's unit", async ({
  page,
}) => {
  await openLive(page);
  await pickMode(page, "Velocity");
  await setGoal(page, "600");
  await expect(page.getByLabel("Goal readout")).toHaveText("600 counts/s");
  const motion = page.getByRole("region", { name: /^Motion/ });
  await expect(motion).toBeVisible();
  await expect(page.getByLabel("Goal value")).toHaveText("600 counts/s");
});

test("a current goal reads back in milliamps and the goal series moves to Electrical", async ({
  page,
}) => {
  await openLive(page);
  await pickMode(page, "Current");
  await setGoal(page, "50");
  await expect(page.getByLabel("Goal readout")).toHaveText("50 mA");
  await expect(page.getByLabel("Goal value")).toHaveText("50 mA");
});

test("position mode shows the goal in counts and the servo's answer to a goal it rejects", async ({
  page,
}) => {
  await openLive(page);
  await pickMode(page, "Position");
  await expect(page.getByLabel("Goal value")).toHaveText("0 counts");
  // The simulated servo's physical position limits are both 0, so any other
  // goal fails the firmware's validator; the answer lands in the cluster.
  await setGoal(page, "2000");
  await expect(page.getByText("servo answered Validation")).toBeVisible();
  await expect(page.getByLabel("Goal value")).toHaveText("0 counts");
});

test("torque on reads back on and the servo keeps answering without a fault", async ({ page }) => {
  await openLive(page);
  const torque = page.getByRole("switch", { name: "Torque" });
  await expect(torque).toHaveAttribute("aria-checked", "false");
  await torque.click();
  await expect(torque).toHaveAttribute("aria-checked", "true");
  await page.waitForTimeout(1000);
  await expect(page.getByRole("button", { name: "ID 1 raw", exact: true })).toBeVisible();
  await expect(page.getByText(/servo answered/)).toHaveCount(0);
});

test("the window select changes the window", async ({ page }) => {
  await openLive(page);
  const window = page.getByRole("combobox", { name: "10 Hz, last" });
  await expect(window).toHaveText("30 s");
  await window.click();
  await page.getByRole("option", { name: "10 s" }).click();
  await expect(window).toHaveText("10 s");
});

test("pause freezes the readouts while the poll runs on, resume lets them move", async ({
  page,
}) => {
  await openLive(page);
  const position = page.getByLabel("Position value");
  const current = page.getByLabel("Current value");
  await expect(current).toHaveText(/ mA$/);
  await page.getByRole("button", { name: "Pause" }).click();
  const [p0, c0] = await Promise.all([position.textContent(), current.textContent()]);
  await page.waitForTimeout(1500);
  expect(await position.textContent()).toBe(p0);
  expect(await current.textContent()).toBe(c0);
  await page.getByRole("button", { name: "Resume" }).click();
  // The replayed current is noisy every tick, so it moves within a few polls.
  await expect(current).not.toHaveText(c0 ?? "", { timeout: 5000 });
});
