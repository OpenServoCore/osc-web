import { expect, test } from "@playwright/test";
import { openTable, tableRow } from "./helpers";

// The sim's calibration maps 4090 counts onto 202 deg: 0.0494 deg per count.
test("the trajectory limits read in degrees with the register's own value beside them", async ({
  page,
}) => {
  await openTable(page);
  await page.getByRole("button", { name: /^Control loops/ }).click();
  const velocity = tableRow(page, "velocity_limit_cps").getByRole("cell");
  await expect(velocity).toContainText("74 deg/s");
  await expect(velocity).toContainText("1500 counts/s");
  // 3840 / 256 = 15 counts/s per medium tick, at 2 kHz 30000 counts/s^2.
  const accel = tableRow(page, "accel_limit_q88").getByRole("cell");
  await expect(accel).toContainText("1482 deg/s^2");
  await expect(accel).toContainText("3840 Q8.8");
});
