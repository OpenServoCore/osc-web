import { expect, test, type Page } from "@playwright/test";
import { errorSeries, hoverWords } from "../../src/lib/pot-lut";
import { gotoSim, MG90A, writeTable } from "./helpers";

/** The simulated servo's angle map: stops 5..4095 read 0..202 deg. */
const SIM = {
  rawMin: 5,
  rawMax: 4095,
  angleMinCdeg: 0,
  angleMaxCdeg: 20200,
  gearRatioCenti: 25464,
};

async function openServo(page: Page, id: number): Promise<void> {
  await page.getByRole("button", { name: `ID ${id}` }).click();
  await expect(page.getByRole("heading", { name: `ID ${id}` })).toBeVisible();
}

test("a servo without a table says so, with nothing to grade", async ({ page }) => {
  await gotoSim(page, [1, 2]);
  await openServo(page, 1);
  const card = page.getByRole("region", { name: "Position calibration" });
  await expect(card.getByLabel("Table state")).toHaveText("No table: the sensor is read as-is.");
  await expect(card.getByLabel("Table facts")).toContainText(
    "No calibration points: the table is all zeros.",
  );
  await expect(card.getByLabel("Table facts")).toContainText("Stops at raw 5 and 4095");
  await expect(card.getByLabel("Grade")).toHaveCount(0);
  await expect(card.getByRole("region", { name: "Error vs position" })).toHaveCount(0);
  await expect(card.getByText("lut_state 0x1de = 0 IDENTITY")).toBeVisible();
});

test("the mg90-a table reads live, graded A, its error in degrees and percent of travel", async ({
  page,
}) => {
  await gotoSim(page, [1, 2]);
  await writeTable(page, 1, MG90A.knots);
  await openServo(page, 1);
  const card = page.getByRole("region", { name: "Position calibration" });
  await expect(card.getByLabel("Table state")).toHaveText(
    "Live: the servo corrects every sensor sample through this table.",
  );
  await expect(card.getByLabel("Grade")).toHaveText("Grade A - smooth");
  const facts = card.getByLabel("Table facts");
  await expect(facts).toContainText("185 calibration points between 27.4 deg and 172.8 deg.");
  await expect(facts).not.toContainText(/knot|correction/);
  const graph = card.getByRole("region", { name: "Error vs position" });
  await expect(graph).toHaveCount(1);
  await expect(graph.getByLabel("Error headline")).toHaveText(
    "The sensor reads up to 3.5 deg (1.7% of travel) off; this table corrects it.",
  );
  await expect(card.getByRole("region", { name: "Local gain" })).toHaveCount(0);
  await expect(card.getByRole("region", { name: "Correction curve" })).toHaveCount(0);
  await expect(card.getByText("lut_state 0x1de = 2 LIVE")).toBeVisible();
  await card.getByLabel("Grade").hover();
  await expect(page.getByRole("tooltip")).toContainText("0.5x..2x");
  // Hovering the plot reads the position under the cursor and the error the
  // table removes there. The readout rounds the position to 0.1 deg, which
  // is about two raw counts, so any of those counts' readouts is the answer.
  const readout = graph.getByLabel("Hover readout");
  await expect(readout).toHaveText("");
  await graph.locator(".u-over").hover();
  await expect(readout).toHaveText(
    / deg: (reads (high|low) by \d+\.\d deg \(\d+\.\d% of travel\)|on target)$/,
  );
  const text = (await readout.textContent()) ?? "";
  const deg = Number(/^(-?\d+\.\d) deg:/.exec(text)?.[1]);
  const s = errorSeries(MG90A.knots, SIM);
  const raw = Math.round(SIM.rawMin + deg / (202 / 4090));
  const candidates = [-2, -1, 0, 1, 2].map((d) => hoverWords(s, raw + d - SIM.rawMin));
  expect(candidates).toContain(text);
  expect(text).toMatch(/reads (high|low)/);
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
    page.getByRole("region", { name: "Position calibration" }).getByLabel("Table state"),
  ).toHaveText("No table: the sensor is read as-is.");
});
