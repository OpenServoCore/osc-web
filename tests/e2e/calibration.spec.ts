import { expect, test, type Locator, type Page } from "@playwright/test";
import { gotoSim } from "./helpers";

// The sim boots with the whole calibration block at zero, so three edits
// (sensor top, angle top, gear ratio) are what it takes to reach "Calibrated".
const VALUE = /^-?\d+(\.\d+)?( counts| deg)?$/;

async function openCalibration(page: Page, id: number): Promise<Locator> {
  await gotoSim(page, [1, 2]);
  await page.getByRole("button", { name: `ID ${id}` }).click();
  await expect(page.getByRole("heading", { name: `ID ${id}` })).toBeVisible();
  return page.getByRole("region", { name: "Calibration" });
}

async function edit(card: Locator, row: string, from: string, text: string): Promise<void> {
  await card.getByRole("group", { name: row }).getByRole("button", { name: from }).click();
  await card.page().getByRole("textbox").fill(text);
  await card.page().getByRole("button", { name: "Apply" }).click();
  await expect(card.page().getByRole("textbox")).toBeHidden();
}

test("the card shows the status chip and one row per calibration register", async ({ page }) => {
  const card = await openCalibration(page, 1);
  await card.getByText("Not calibrated").hover();
  await expect(page.getByRole("tooltip")).toContainText("sensor lowest must be below");
  for (const row of [
    "Sensor lowest",
    "Sensor highest",
    "Angle lowest",
    "Angle highest",
    "Gear ratio",
  ]) {
    const group = card.getByRole("group", { name: row });
    await expect(group.getByRole("button", { name: VALUE })).toBeVisible();
  }
  await expect(card.getByText("raw_max 0x082")).toBeVisible();
});

test("edits write through, the row shows the new value and the status follows", async ({
  page,
}) => {
  const card = await openCalibration(page, 1);
  await edit(card, "Sensor highest", "0 counts", "4000");
  await expect(
    card
      .getByRole("group", { name: "Sensor highest" })
      .getByRole("button", { name: "4000 counts" }),
  ).toBeVisible();
  await expect(card.getByText("Not calibrated")).toBeVisible();

  await edit(card, "Angle highest", "0.00 deg", "180");
  await expect(
    card.getByRole("group", { name: "Angle highest" }).getByRole("button", { name: "180.00 deg" }),
  ).toBeVisible();
  await edit(card, "Gear ratio", "0.00", "1");
  await expect(
    card.getByRole("group", { name: "Gear ratio" }).getByRole("button", { name: "1.00" }),
  ).toBeVisible();
  await expect(card.getByText("Calibrated", { exact: true })).toBeVisible();
});

test("an edit that inverts the sensor range is refused until cancelled", async ({ page }) => {
  const card = await openCalibration(page, 1);
  await edit(card, "Sensor highest", "0 counts", "4000");
  const lowest = card.getByRole("group", { name: "Sensor lowest" });
  await lowest.getByRole("button", { name: "0 counts" }).click();
  const input = page.getByRole("textbox");
  await input.fill("4100");
  await expect(page.getByText("sensor lowest must be below sensor highest")).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply" })).toBeDisabled();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(input).toBeHidden();
  await expect(lowest.getByRole("button", { name: "0 counts" })).toBeVisible();

  const highest = card.getByRole("group", { name: "Sensor highest" });
  await highest.getByRole("button", { name: "4000 counts" }).click();
  await input.fill("5000");
  await expect(page.getByText("sensor range must sit inside 0 to 4095 counts")).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply" })).toBeDisabled();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(highest.getByRole("button", { name: "4000 counts" })).toBeVisible();
});
