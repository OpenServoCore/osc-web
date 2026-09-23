import { expect, test, type Page } from "@playwright/test";
import { gotoSim } from "./helpers";

async function openLive(page: Page, opts: { debug?: boolean } = {}): Promise<void> {
  await gotoSim(page, [1, 2], opts);
  await page.getByRole("button", { name: "ID 1" }).click();
  // The servo page proves the selection landed: leaving for Live while that
  // navigation is still compiling on a cold dev server races the two.
  await expect(page.getByRole("heading", { name: "ID 1" })).toBeVisible();
  await page.getByRole("link", { name: "Live" }).click();
  // A cold dev server compiles the Live route chunk on this first request.
  await expect(page.getByRole("region", { name: /^Motion/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("waiting for data")).toHaveCount(0);
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
  await expect(page.getByLabel("Goal readout")).toHaveText(/ deg\/s$/);
  await pickMode(page, "Position");
  await expect(page.getByLabel("Goal readout")).toHaveText(/ deg$/);
  await pickMode(page, "Open loop");
  await expect(page.getByLabel("Goal readout")).toHaveText(/ %$/);
  await expect(page.getByRole("alert")).toBeVisible();
});

test("a velocity goal reads back into the Motion goal readout in the mode's unit", async ({
  page,
}) => {
  await openLive(page);
  await pickMode(page, "Velocity");
  // Inside velocity_limit_cps, which caps the slider at 74 deg/s.
  await setGoal(page, "50");
  await expect(page.getByLabel("Goal readout")).toHaveText("50 deg/s");
  const motion = page.getByRole("region", { name: /^Motion/ });
  await expect(motion).toBeVisible();
  await expect(page.getByLabel("Goal value")).toHaveText("50 deg/s");
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

test("position mode shows the goal in degrees and a goal past the rail stops at it", async ({
  page,
}) => {
  await openLive(page);
  await pickMode(page, "Position");
  // goal_position boots at 0, one count below the calibrated sensor floor.
  await expect(page.getByLabel("Goal value")).toHaveText("-0.2 deg");
  await setGoal(page, "100");
  await expect(page.getByLabel("Goal value")).toHaveText("100.0 deg");
  // The slider's range is the calibrated sensor span, which is also what the
  // firmware validates against, so a goal beyond it clamps instead of nacking.
  await setGoal(page, "500");
  await expect(page.getByLabel("Goal value")).toHaveText("202.0 deg");
  await expect(page.getByText(/servo answered/)).toHaveCount(0);
});

test("torque on reads back on and the servo keeps answering without a fault", async ({ page }) => {
  await openLive(page);
  const torque = page.getByRole("switch", { name: "Torque" });
  await expect(torque).toHaveAttribute("aria-checked", "false");
  await torque.click();
  await expect(torque).toHaveAttribute("aria-checked", "true");
  await page.waitForTimeout(1000);
  await expect(page.getByRole("button", { name: "ID 1", exact: true })).toBeVisible();
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

test("a burst of goal changes lands on the last one and coalesces into the bus", async ({
  page,
}) => {
  await openLive(page, { debug: true });
  await pickMode(page, "Velocity");
  await setGoal(page, "50");
  const readout = page.getByLabel("Goal readout");
  await expect(readout).toHaveText("50 deg/s");
  const thumb = page.getByRole("slider");
  await thumb.focus();
  // One microtask between steps is enough for the slider to see the new value
  // and far too little for an exchange to settle, so the steps outrun the bus
  // the way a drag does on hardware.
  await thumb.evaluate(async (el) => {
    for (let i = 0; i < 20; i++) {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      await Promise.resolve();
    }
  });
  // Twenty counts of goal_velocity is one deg/s at the fleet's calibration.
  await expect(readout).toHaveText("51 deg/s");
  // The servo's own read-back, off the telemetry ring.
  await expect(page.getByLabel("Goal value")).toHaveText("51 deg/s");
  const panel = page.getByRole("region", { name: "Bus statistics" });
  await expect(panel.locator('dt:text-is("coalesced") + dd')).not.toHaveText("0");
  await expect(panel.locator('dt:text-is("errors") + dd')).toHaveText("0");
});
