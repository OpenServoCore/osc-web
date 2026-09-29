import { expect, test, type Page } from "@playwright/test";
import { gotoSim, MG90A, writeTable } from "./helpers";

async function openServo(page: Page, id: number): Promise<void> {
  await page.getByRole("button", { name: `ID ${id}` }).click();
  await expect(page.getByRole("heading", { name: `ID ${id}` })).toBeVisible();
}

test("a servo without a table says so, with nothing to grade", async ({ page }) => {
  await gotoSim(page, [1, 2]);
  await openServo(page, 1);
  const card = page.getByRole("region", { name: "Pot table" });
  await expect(card.getByLabel("Table state")).toHaveText("No table: the pot is read as-is.");
  await expect(card.getByLabel("Table facts")).toContainText("No corrections: every knot is zero.");
  await expect(card.getByLabel("Table facts")).toContainText("Stops at raw 5 and 4095");
  await expect(card.getByLabel("Grade")).toHaveCount(0);
  await expect(card.getByText("lut_state 0x1de = 0 IDENTITY")).toBeVisible();
});

test("the mg90-a table reads live, graded A with its curve, and the set unstamped", async ({
  page,
}) => {
  await gotoSim(page, [1, 2]);
  await writeTable(page, 1, MG90A.knots);
  await openServo(page, 1);
  const card = page.getByRole("region", { name: "Pot table" });
  await expect(card.getByLabel("Table state")).toHaveText(
    "Live: the servo corrects every pot sample through this table.",
  );
  await expect(card.getByLabel("Grade")).toHaveText("Grade A - smooth");
  const facts = card.getByLabel("Table facts");
  await expect(facts).toContainText("185 corrections at raw 560..3504, up to 71 counts.");
  await expect(facts).toContainText(
    "Steepest interval 2.06x at raw 1360..1376, shallowest 0.50x at raw 752..768.",
  );
  await expect(facts).toContainText(
    "25-count windows over raw 544..3520: 0.61x to 1.88x of nominal.",
  );
  await expect(card.getByRole("region", { name: "Correction curve" })).toBeVisible();
  await expect(card.getByRole("region", { name: "Local gain" })).toBeVisible();
  await expect(card.getByText("lut_state 0x1de = 2 LIVE")).toBeVisible();
  await card.getByLabel("Grade").hover();
  await expect(page.getByRole("tooltip")).toContainText("0.5x..2x");
  // A new table re-defines the domain the constants were fitted in: the
  // COMMIT checkpoint leaves the set unstamped until osc ident runs.
  await expect(page.getByRole("status", { name: "Data state" })).toContainText(
    "the pot table and the identified values are not one set",
  );
  await expect(page.getByRole("group", { name: "Plant stamp" })).toContainText(
    "Changed since it was stamped",
  );
  // The other servo keeps its own state.
  await openServo(page, 2);
  await expect(
    page.getByRole("region", { name: "Pot table" }).getByLabel("Table state"),
  ).toHaveText("No table: the pot is read as-is.");
});
