import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const PROFILE = readFileSync(
  new URL("../../../open-servo-core/measure/testdata/mg90-d/profile.json", import.meta.url),
  "utf8",
);

/** The record's profile as an SG90-class servo: the same ratings on plastic gears. */
const PLASTIC = JSON.stringify({
  ...(JSON.parse(PROFILE) as Record<string, unknown>),
  key: "towerpro-sg90",
  model: { maker: "TowerPro", name: "SG90", variant: "" },
  gear_class: "plastic",
});

async function importProfile(page: Page, name: string, text: string): Promise<void> {
  await page.getByLabel("Profile file").setInputFiles({
    name,
    mimeType: "application/json",
    buffer: Buffer.from(text),
  });
  await expect(page.getByRole("status")).toContainText("Imported");
}

/** The profiles the preview reads, put in the library through the profiles page. */
async function openPolicies(page: Page, plastic = false): Promise<Locator> {
  await page.goto("/profiles?sim=1");
  await expect(page.getByRole("heading", { name: "Servo profiles" })).toBeVisible({
    timeout: 15_000,
  });
  await importProfile(page, "profile.json", PROFILE);
  if (plastic) await importProfile(page, "sg90.json", PLASTIC);
  await page.getByRole("link", { name: "Policies" }).click();
  await expect(page.getByRole("heading", { name: "Tuning policies" })).toBeVisible();
  const card = page.getByRole("region", { name: "Policy" });
  await card.getByLabel("Preview resistance").fill("4.18");
  return card;
}

function row(card: Locator, label: string): Locator {
  return card.getByRole("group", { name: label, exact: true });
}

async function copyDefault(page: Page, card: Locator): Promise<void> {
  await page.getByRole("button", { name: "Copy to edit" }).click();
  const editor = page.getByRole("dialog", { name: "Copy to edit" });
  await editor.getByLabel("Name").fill("Arm joints");
  await expect(editor).toContainText("= policies/arm-joints.json");
  await editor.getByRole("button", { name: "Copy" }).click();
  await expect(editor).toBeHidden();
  await expect(card).toContainText("arm-joints . revision 1");
}

test("Default with vorpal-mg90 at 4.18 ohm previews 400 deg/s, 200 deg/s, 4000 deg/s^2 and the cap", async ({
  page,
}) => {
  const card = await openPolicies(page);
  await expect(card.getByRole("combobox")).toHaveText("vorpal-mg90");
  await expect(card.getByText("portable", { exact: true })).toBeVisible();
  await expect(row(card, "Move speed")).toContainText("0.5 of the ceiling");
  await expect(row(card, "Move speed")).toContainText("= 200°/s");
  await expect(row(card, "Speed-up time")).toContainText("= 4000°/s²");
  await expect(row(card, "Max yield torque")).toContainText("the cap, no fold");
  await expect(row(card, "Runs on")).toContainText("picks the 4.8 V rating");
  await expect(card.getByRole("group", { name: "Plastic torque limit" })).toHaveCount(0);

  await card.getByRole("button", { name: "Show all" }).click();
  await expect(row(card, "Speed ceiling")).toContainText("= 400°/s");
  await expect(row(card, "Current limit")).toContainText("= 0.92 A at 4.18 Ω, set by the run");
  await expect(row(card, "Stall speed")).toContainText("set by the run");
  await expect(row(card, "Move speed")).toContainText("half the speed ceiling");
});

test("a plastic profile shows the plastic limit, its checkbox and the stripping sentence", async ({
  page,
}) => {
  const card = await openPolicies(page, true);
  await card.getByRole("combobox").click();
  await page.getByRole("option", { name: "towerpro-sg90" }).click();
  await expect(row(card, "Max yield torque")).toContainText(
    "the plastic torque limit, not known yet",
  );
  const limit = row(card, "Plastic torque limit");
  await expect(limit).toContainText("not known yet");
  await expect(limit.getByRole("checkbox", { name: "Go above the plastic limit" })).toBeVisible();
  await expect(limit).toContainText("Above this, plastic teeth strip when the horn is blocked.");
  await expect(card).toContainText(
    "The yield current a stalled horn folds to cannot be set: the plastic torque limit, the yield torque of a plastic train, is not known yet",
  );

  await card.getByRole("button", { name: "Show all" }).click();
  await expect(row(card, "Stall speed")).toContainText("set by the run");
  await expect(row(card, "Pot jump")).toContainText("set by the run");
});

test("Default cannot be edited, and a copy can: move speed 0.75 previews 300 deg/s", async ({
  page,
}) => {
  const card = await openPolicies(page);
  await expect(row(card, "Move speed").getByRole("button")).toHaveCount(0);
  await expect(card).toContainText("default . built in, copy to edit");

  await copyDefault(page, card);
  await row(card, "Move speed").getByRole("button", { name: "0.5 of the ceiling" }).click();
  const editor = page.getByRole("dialog", { name: "Move speed" });
  await editor.getByLabel("Move speed").fill("0.75");
  await expect(editor).toContainText("= 300°/s with vorpal-mg90");
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(editor).toBeHidden();
  await expect(row(card, "Move speed")).toContainText("= 300°/s");
  await expect(card).toContainText("arm-joints . revision 2");
  await expect(card.getByText("portable", { exact: true })).toBeVisible();

  // Fixed carries the value over at the ceiling, and ties the policy to one servo.
  await row(card, "Move speed").getByRole("button", { name: "0.75 of the ceiling" }).click();
  await editor.getByRole("tab", { name: "Fixed" }).click();
  await expect(editor.getByLabel("Move speed")).toHaveValue("300");
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(row(card, "Move speed").getByRole("button", { name: "300°/s" })).toBeVisible();
  await expect(card.getByText("1 fixed", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Policies" })).toContainText("1 fixed");
});

test("a current share of 0.9 warns that a jammed horn can strip the gears", async ({ page }) => {
  const card = await openPolicies(page);
  await copyDefault(page, card);
  await card.getByRole("button", { name: "Show all" }).click();
  await row(card, "Current limit")
    .getByRole("button", { name: "0.8 of the stall current" })
    .click();
  const editor = page.getByRole("dialog", { name: "Current limit" });
  await editor.getByLabel("Share of the stall current").fill("0.9");
  await expect(editor.getByRole("status")).toHaveText(
    "The motor may draw closer to its full stall current. A jammed horn heats the winding faster and can strip the gears.",
  );
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(editor).toBeHidden();
  await expect(row(card, "Current limit")).toContainText("= 1.03 A at 4.18 Ω, set by the run");
});

test("Default puts 0 deg at the center of travel, and a copy moves it", async ({ page }) => {
  const card = await openPolicies(page);
  await card.getByRole("button", { name: "Show all" }).click();
  const center = row(card, "Center offset");
  await expect(center).toContainText("0°, the center of travel");
  await expect(center).toContainText("none stated: 0 deg is the servo's center of travel");
  await expect(center).toContainText("A positive offset moves 0° counterclockwise.");
  await expect(card).not.toContainText("CW stop");

  await copyDefault(page, card);
  await card.getByRole("button", { name: "Show all" }).click();
  await center.getByRole("button", { name: "0°, the center of travel" }).click();
  const editor = page.getByRole("dialog", { name: "Center offset" });
  await editor.getByLabel("Center offset").fill("-12.5");
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(editor).toBeHidden();
  await expect(center.getByRole("button", { name: "-12.5°" })).toBeVisible();
  await expect(card).toContainText("arm-joints . revision 2");
});

test("a policy stored with the CW stop angle shows its refusal, and an entry takes it out", async ({
  page,
}) => {
  const card = await openPolicies(page);
  await copyDefault(page, card);
  await page.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("policies");
    const handle = await dir.getFileHandle("arm-joints.json");
    const stored = JSON.parse(await (await handle.getFile()).text()) as {
      motion: Record<string, unknown>;
    };
    stored.motion.angle_cw_stop_deg = 0;
    const writable = await handle.createWritable();
    await writable.write(`${JSON.stringify(stored, null, 2)}\n`);
    await writable.close();
  });
  await page.goto("/policies?sim=1&policy=arm-joints");
  await expect(card).toContainText("arm-joints . revision 1");
  await card.getByRole("button", { name: "Show all" }).click();
  const center = row(card, "Center offset");
  await expect(center).toContainText(
    "the policy states motion.angle_cw_stop_deg, which this tool no longer reads: 0 deg is the servo's center of travel; to move it, state motion.center_offset_deg",
  );

  await center.getByRole("button", { name: "0°, the center of travel" }).click();
  const editor = page.getByRole("dialog", { name: "Center offset" });
  await editor.getByLabel("Center offset").fill("2");
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(editor).toBeHidden();
  await expect(center.getByRole("button", { name: "2°" })).toBeVisible();
  await expect(center).not.toContainText("no longer reads");
  const stored = await page.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("policies");
    const file = await (await dir.getFileHandle("arm-joints.json")).getFile();
    return JSON.parse(await file.text()) as { motion: Record<string, unknown> };
  });
  expect(stored.motion.angle_cw_stop_deg).toBeUndefined();
  expect(stored.motion.center_offset_deg).toBe(2);
});
