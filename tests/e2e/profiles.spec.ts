import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const testdata = (name: string): Buffer =>
  readFileSync(
    new URL(`../../../open-servo-core/measure/testdata/mg90-d/${name}`, import.meta.url),
  );

const NAMEPLATE = testdata("nameplate.json");
const THERMAL = testdata("thermal.json");

const NO_HEAT_MODEL =
  "The run prices the heat of every drive and writes the winding temperature estimate from the motor's heat model";

const MG90_HEAT = "fast 2.37522 s, 20.4457 °C/W; slow 128.92 s, 76.7616 °C/W";

async function openPage(page: Page): Promise<Locator> {
  await page.goto("/profiles?sim=1");
  await expect(page.getByRole("heading", { name: "Servo profiles" })).toBeVisible({
    timeout: 15_000,
  });
  return page.getByRole("region", { name: "Profile" });
}

/** Opens the row's editor from its value, fills each labelled control and saves. */
async function edit(
  card: Locator,
  row: string,
  value: string,
  fill: Record<string, string>,
): Promise<void> {
  await card.getByRole("group", { name: row }).getByRole("button", { name: value }).click();
  const editor = card.page().getByRole("dialog");
  for (const [label, text] of Object.entries(fill)) await editor.getByLabel(label).fill(text);
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(editor).toBeHidden();
}

async function choose(card: Locator, row: string, value: string, option: string): Promise<void> {
  await card.getByRole("group", { name: row }).getByRole("button", { name: value }).click();
  const editor = card.page().getByRole("dialog");
  await editor.getByRole("combobox").click();
  await card.page().getByRole("option", { name: option }).click();
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(editor).toBeHidden();
}

async function newProfile(page: Page, maker: string, name: string): Promise<void> {
  await page.getByRole("button", { name: "New profile" }).click();
  const editor = page.getByRole("dialog", { name: "New profile" });
  await editor.getByLabel("Maker").fill(maker);
  await editor.getByLabel("Model").fill(name);
  await expect(editor).toContainText("= profiles/");
  await editor.getByRole("button", { name: "Create" }).click();
  await expect(editor).toBeHidden();
}

/** The bench MG90 as its sheet and a teardown give it. */
async function enterMg90(card: Locator): Promise<void> {
  const page = card.page();
  await choose(card, "Gear material", "not set", "Metal");
  await card.getByRole("button", { name: "Count teeth" }).click();
  const teeth = page.getByRole("dialog", { name: "Count teeth" });
  await teeth.getByRole("textbox").fill("9:48 12:48 10:38 10:38");
  await expect(teeth).toContainText("= 308.05 : 1 over 4 stages");
  await teeth.getByRole("button", { name: "Save" }).click();
  await expect(teeth).toBeHidden();
  await edit(card, "Brushes and segments", "Brushes: not set", { Brushes: "2" });
  await edit(card, "Brushes and segments", "Segments: not set", {
    "Commutator segments": "3",
  });
  await edit(card, "Stop to stop", "not set", { "Travel stop to stop": "184.33" });
  await choose(card, "Counterclockwise raises the reading", "not set", "Yes");
  await edit(card, "Operating range", "not set", { Lowest: "4.8", Highest: "6.6" });
  await card.getByRole("button", { name: "Add a rating" }).click();
  const rating = page.getByRole("dialog", { name: "Add a rating" });
  await rating.getByLabel("At").fill("4.8");
  await rating.getByLabel("No-load speed").fill("0.10");
  await rating.getByLabel("Stall torque (optional)").fill("1.8");
  await expect(rating).toContainText("= 600°/s, 30,800 motor rpm");
  await rating.getByRole("button", { name: "Save" }).click();
  await expect(rating).toBeHidden();
  await edit(card, "Heat model", "not set", {
    "Fast time constant": "2.37522",
    "Fast gain": "20.4457",
    "Slow time constant": "128.92",
    "Slow gain": "76.7616",
  });
}

async function expectMg90Values(card: Locator): Promise<void> {
  await expect(
    card.getByRole("group", { name: "Gear ratio" }).getByRole("button", { name: "308.05 : 1" }),
  ).toBeVisible();
  await expect(card.getByRole("group", { name: "Brushes and segments" })).toContainText(
    "6 ripple pulses a motor turn",
  );
  const rating = card.getByRole("group", { name: "Rating at 4.8 V" });
  await expect(rating).toContainText("0.10 s/60°");
  await expect(rating).toContainText("= 600°/s");
  await expect(rating).toContainText("30,800 motor rpm");
  await expect(
    card.getByRole("group", { name: "Heat model" }).getByRole("button", { name: MG90_HEAT }),
  ).toBeVisible();
}

test("a blank profile with the MG90's values shows the ratio from the teeth, 6 pulses a turn and 600 deg/s at 4.8 V", async ({
  page,
}) => {
  const card = await openPage(page);
  await expect(page.getByText("No profiles yet.")).toBeVisible();
  await newProfile(page, "Vorpal", "MG90");
  await expect(card.getByText("Vorpal MG90", { exact: true })).toBeVisible();
  await expect(card).toContainText("vorpal-mg90 . revision 1");
  await expect(card.getByText("8 missing")).toBeVisible();
  await expect(card.getByRole("group", { name: "Gear ratio" })).toContainText(
    "Without the gear ratio the run cannot turn motor turns into horn degrees",
  );
  await expect(card.getByRole("group", { name: "Heat model" })).toContainText(NO_HEAT_MODEL);

  await enterMg90(card);
  await expectMg90Values(card);
  await expect(card.getByText("ready", { exact: true })).toBeVisible();
  await expect(card.getByRole("group", { name: "Gear ratio" })).not.toContainText("Without");
  await expect(card).not.toContainText(NO_HEAT_MODEL);

  await card.getByRole("button", { name: "Show all" }).click();
  await expect(card.getByRole("group", { name: "Gear ratio" })).toContainText(
    "gear_ratio . counted . 9:48 x 12:48 x 10:38 x 10:38",
  );

  // The files live in the browser's storage, so a reload keeps them.
  await page.reload();
  await expectMg90Values(card);
  await expect(page.getByRole("navigation", { name: "Profiles" })).toContainText("vorpal-mg90");
});

test("clearing the gear ratio shows the run's gear-ratio sentence", async ({ page }) => {
  const card = await openPage(page);
  await newProfile(page, "Vorpal", "MG90");
  await enterMg90(card);
  await expect(card.getByText("ready", { exact: true })).toBeVisible();

  await card
    .getByRole("group", { name: "Gear ratio" })
    .getByRole("button", { name: "308.05 : 1" })
    .click();
  const editor = page.getByRole("dialog", { name: "Gear ratio" });
  await editor.getByLabel("Gear ratio").fill("");
  await expect(editor).toContainText("Without the gear ratio");
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(editor).toBeHidden();

  const row = card.getByRole("group", { name: "Gear ratio" });
  await expect(row.getByRole("button", { name: "not set" })).toBeVisible();
  await expect(row).toContainText(
    "Without the gear ratio the run cannot turn motor turns into horn degrees",
  );
  await expect(card.getByText("1 missing")).toBeVisible();
  await expect(card).toContainText("vorpal-mg90 . revision 11");
});

test("a ratio the run refuses is not saved", async ({ page }) => {
  const card = await openPage(page);
  await newProfile(page, "Vorpal", "MG90");
  await card
    .getByRole("group", { name: "Gear ratio" })
    .getByRole("button", { name: "not set" })
    .click();
  const editor = page.getByRole("dialog", { name: "Gear ratio" });
  await editor.getByLabel("Gear ratio").fill("0");
  await expect(editor.getByRole("status")).toContainText("Without the gear ratio");
  await expect(editor.getByRole("button", { name: "Save" })).toBeDisabled();
  await editor.getByLabel("Gear ratio").fill("abc");
  await expect(editor.getByRole("status")).toHaveText(`"abc" is not a number`);
  await page.keyboard.press("Escape");
  await expect(card).toContainText("revision 1");
});

test("importing the version 0 nameplate with its thermal.json gives the same values", async ({
  page,
}) => {
  const card = await openPage(page);
  const file = (name: string, buffer: Buffer) => ({ name, mimeType: "application/json", buffer });
  await page.getByLabel("Profile file").setInputFiles(file("thermal.json", THERMAL));
  await expect(page.getByRole("status")).toHaveText(
    "thermal.json was not imported: thermal.json is the heat model beside a version 0 nameplate: import the nameplate with it",
  );

  await page
    .getByLabel("Profile file")
    .setInputFiles([file("nameplate.json", NAMEPLATE), file("thermal.json", THERMAL)]);
  await expect(page.getByRole("status")).toContainText(
    "Imported mg90-d from nameplate.json and thermal.json.",
  );
  await expect(page.getByRole("status")).toContainText("the thermal.json beside it as its thermal");
  await expect(card).toContainText("mg90-d . revision 1");
  await expectMg90Values(card);
  await expect(card.getByText("ready", { exact: true })).toBeVisible();

  await page.getByLabel("Profile file").setInputFiles({
    name: "broken.json",
    mimeType: "application/json",
    buffer: Buffer.from("{"),
  });
  await expect(page.getByRole("status")).toHaveText(
    "broken.json was not imported: broken.json is not JSON",
  );
});

test("plastic gears show the cannot-identify line", async ({ page }) => {
  const card = await openPage(page);
  await newProfile(page, "TowerPro", "SG90");
  await choose(card, "Gear material", "not set", "Plastic");
  await expect(card.getByRole("group", { name: "Gear material" })).toContainText(
    "Identification presses the horn against its stops. Plastic gears can strip, so only metal-gear servos can be identified for now.",
  );
  await expect(page.getByRole("navigation", { name: "Profiles" })).toContainText(
    "plastic . cannot identify",
  );
  await choose(card, "Gear material", "Plastic", "Metal");
  await expect(card.getByRole("group", { name: "Gear material" })).not.toContainText(
    "Plastic gears can strip",
  );
});

test("the Library's Profiles link stays open with no adapter", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Not connected" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Profiles" }).click();
  await expect(page.getByRole("heading", { name: "Servo profiles" })).toBeVisible();
  await expect(page.getByText("No profiles yet.")).toBeVisible();
});
