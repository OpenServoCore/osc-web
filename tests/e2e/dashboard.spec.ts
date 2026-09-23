import { expect, test } from "@playwright/test";
import { gotoSim } from "./helpers";

const UID_1 = "c94b8419d1092aec87de5fd151ce290f";
const UID_2 = "30634f42dde2095340c8d84f67f28244";
// The simulated fleet boots calibrated, so the position readout is degrees.
const READOUT = /^-?\d+(\.\d+)? deg$/;

test("each simulated servo gets a card with its identity and a position readout", async ({
  page,
}) => {
  await gotoSim(page, [1, 2]);
  for (const [id, uid] of [
    [1, UID_1],
    [2, UID_2],
  ] as const) {
    const card = page.getByRole("link", { name: new RegExp(`^ID ${id}\\b`) });
    await expect(card).toBeVisible();
    await expect(card.getByText(uid)).toBeVisible();
    await expect(card.getByText("0x0101")).toBeVisible();
    await expect(card.getByText("0.1.0")).toBeVisible();
    await expect(card.getByText(READOUT)).toBeVisible();
  }
});

test("clicking a card opens the Servo page with that servo selected", async ({ page }) => {
  await gotoSim(page, [1, 2]);
  await page.getByRole("link", { name: /^ID 2\b/ }).click();
  await expect(page).toHaveURL(/\/servo\?sim=/);
  await expect(page.getByRole("button", { name: "ID 2" })).toHaveAttribute("data-active", "true");
  await expect(page.getByRole("button", { name: "ID 1" })).toHaveAttribute("data-active", "false");
});

test("without ?sim the page offers to connect and shows no cards", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("main").getByRole("button", { name: "Connect adapter" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /^ID \d/ })).toHaveCount(0);
});
