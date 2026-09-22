import { expect, test } from "@playwright/test";
import { gotoSim } from "./helpers";

const UID_1 = "c94b8419d1092aec87de5fd151ce290f";

test("the servo page reports the selected servo's identity and health", async ({ page }) => {
  await gotoSim(page, [1, 2]);
  await page.getByRole("button", { name: "ID 1" }).click();
  await expect(page.getByRole("heading", { name: "ID 1" })).toBeVisible();

  const about = page.getByRole("region", { name: "About" });
  await about.getByText("osc-servo").hover();
  await expect(page.getByRole("tooltip")).toContainText("0x0101");
  await expect(about.getByText("0.1.0")).toBeVisible();
  await expect(about.getByText("1", { exact: true })).toBeVisible();
  await expect(about.getByText(UID_1)).toBeVisible();

  const health = page.getByRole("region", { name: "Health" });
  await expect(health.getByText("No faults.")).toBeVisible();
});

test("the servo page asks for a selection while none is made", async ({ page }) => {
  await page.goto("/servo?sim=1,2");
  await expect(page.getByText("Pick a servo in the left pane.")).toBeVisible();
});
