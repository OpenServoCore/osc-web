import { expect, test, type Locator, type Page } from "@playwright/test";
import { gotoSim } from "./helpers";

// Every simulated servo boots with a real servo's calibration table, so the
// card opens Calibrated and each row reads its seeded value in the row's unit.
const SEEDED: readonly (readonly [string, string])[] = [
  ["Sensor lowest", "5 counts"],
  ["Sensor highest", "4095 counts"],
  ["Angle lowest", "0.00 deg"],
  ["Angle highest", "202.00 deg"],
  ["Gear ratio", "254.64"],
];

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
  await expect(card.getByText("Calibrated", { exact: true })).toBeVisible();
  for (const [row, value] of SEEDED) {
    const group = card.getByRole("group", { name: row });
    await expect(group.getByRole("button", { name: value })).toBeVisible();
  }
  await expect(card.getByText("raw_max 0x082")).toBeVisible();
});

test("edits write through, the row shows the new value and the status stays Calibrated", async ({
  page,
}) => {
  const card = await openCalibration(page, 1);
  await edit(card, "Sensor highest", "4095 counts", "4000");
  await expect(
    card
      .getByRole("group", { name: "Sensor highest" })
      .getByRole("button", { name: "4000 counts" }),
  ).toBeVisible();
  await expect(card.getByText("Calibrated", { exact: true })).toBeVisible();

  await edit(card, "Angle highest", "202.00 deg", "180");
  await expect(
    card.getByRole("group", { name: "Angle highest" }).getByRole("button", { name: "180.00 deg" }),
  ).toBeVisible();
  await expect(card.getByText("Calibrated", { exact: true })).toBeVisible();
});

test("an edit that inverts the sensor range is refused until cancelled", async ({ page }) => {
  const card = await openCalibration(page, 1);
  const lowest = card.getByRole("group", { name: "Sensor lowest" });
  await lowest.getByRole("button", { name: "5 counts" }).click();
  const input = page.getByRole("textbox");
  await input.fill("4100");
  await expect(page.getByText("sensor lowest must be below sensor highest")).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply" })).toBeDisabled();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(input).toBeHidden();
  await expect(lowest.getByRole("button", { name: "5 counts" })).toBeVisible();

  const highest = card.getByRole("group", { name: "Sensor highest" });
  await highest.getByRole("button", { name: "4095 counts" }).click();
  await input.fill("5000");
  await expect(page.getByText("sensor range must sit inside 0 to 4095 counts")).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply" })).toBeDisabled();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(highest.getByRole("button", { name: "4095 counts" })).toBeVisible();
});

// Angle lowest -150 then Angle highest -100 maps the whole sensor range onto
// negative degrees, which the seeded 0 to 202 deg map could never show.
test("an edit reaches the dashboard card without a reload", async ({ page }) => {
  const card = await openCalibration(page, 1);
  await edit(card, "Angle lowest", "0.00 deg", "-150");
  await edit(card, "Angle highest", "202.00 deg", "-100");
  await expect(
    card.getByRole("group", { name: "Angle lowest" }).getByRole("button", { name: "-150.00 deg" }),
  ).toBeVisible();
  await expect(
    card.getByRole("group", { name: "Angle highest" }).getByRole("button", { name: "-100.00 deg" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Dashboard" }).click();
  const dashboard = page.getByRole("link", { name: /^ID 1\b/ });
  await expect(dashboard.getByText(/^-1\d\d(\.\d)? deg$/)).toBeVisible();
});
