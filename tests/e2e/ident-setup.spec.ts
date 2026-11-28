import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { gotoSim } from "./helpers";

const UID_1 = "c94b8419d1092aec87de5fd151ce290f";

const testdata = (name: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(
      new URL(`../../../open-servo-core/measure/testdata/mg90-d/${name}`, import.meta.url),
      "utf8",
    ),
  ) as Record<string, unknown>;

const PROFILE = testdata("profile.json");
const RECORD = { ...testdata("policy-of-record.json"), revision: 1 };
const protection = testdata("policy-of-record.json").protection as Record<string, unknown>;

const ZERO_JUMP =
  "A share or a multiple of 0 or under sets nothing the servo can run on: the policy's sensor.pot_jump is 0; state one over 0";

/** Writes files straight into the browser's storage, as the library pages would have saved them. */
async function seed(page: Page, files: Record<string, unknown>): Promise<void> {
  await page.evaluate(async (files) => {
    const root = await navigator.storage.getDirectory();
    for (const [path, value] of Object.entries(files)) {
      const parts = path.split("/");
      const name = parts.pop() ?? "";
      let dir = root;
      for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
      const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await writable.write(`${JSON.stringify(value, null, 2)}\n`);
      await writable.close();
    }
  }, files);
}

async function readStored(page: Page, path: string): Promise<unknown> {
  return page.evaluate(async (path) => {
    const parts = path.split("/");
    const name = parts.pop() ?? "";
    let dir = await navigator.storage.getDirectory();
    for (const part of parts) dir = await dir.getDirectoryHandle(part);
    return JSON.parse(await (await (await dir.getFileHandle(name)).getFile()).text()) as unknown;
  }, path);
}

/** A fleet of two with the record's profile, one lacking its gear ratio, one its heat model, and three policies. */
async function openServo(page: Page, id: number): Promise<Locator> {
  await gotoSim(page, [1, 2]);
  await seed(page, {
    "profiles/vorpal-mg90.json": PROFILE,
    "profiles/vorpal-mg90-new.json": { ...PROFILE, key: "vorpal-mg90-new", gear_ratio: null },
    "profiles/vorpal-mg90-no-heat.json": { ...PROFILE, key: "vorpal-mg90-no-heat", thermal: null },
    "policies/mg90-d-record.json": RECORD,
    "policies/seven-volts.json": {
      ...RECORD,
      key: "seven-volts",
      protection: { ...protection, run_v: 7.0 },
    },
    "policies/zero-jump.json": {
      ...RECORD,
      key: "zero-jump",
      sensor: { pot_jump: { multiple_of_step4: 0 }, bad_samples: 4 },
    },
  });
  return select(page, id);
}

async function select(page: Page, id: number): Promise<Locator> {
  await page.getByRole("button", { name: `ID ${id}` }).click();
  await expect(page.getByRole("heading", { name: `ID ${id}` })).toBeVisible();
  const card = page.getByRole("region", { name: "Identification" });
  await expect(card.getByRole("combobox", { name: "Policy" })).toBeVisible({ timeout: 15_000 });
  return card;
}

async function choose(card: Locator, which: "Profile" | "Policy", option: string): Promise<void> {
  await card.getByRole("combobox", { name: which }).click();
  await card.page().getByRole("option", { name: option, exact: true }).click();
}

test("the choice survives a reload for that servo, and a second sim servo keeps its own", async ({
  page,
}) => {
  const card = await openServo(page, 1);
  const identify = card.getByRole("button", { name: "Identify" });
  await expect(card).toContainText("Choose the profile that describes this servo's model.");
  await expect(identify).toBeDisabled();

  await choose(card, "Profile", "vorpal-mg90 rev 3");
  await choose(card, "Policy", "mg90-d-record rev 1");
  await expect(identify).toBeEnabled();
  await expect(card).toContainText("The horn moves stop to stop.");
  expect(await readStored(page, `${UID_1}/setup.json`)).toMatchObject({
    profile: { key: "vorpal-mg90", revision: 3 },
    policy: { key: "mg90-d-record", revision: 1 },
  });

  await page.reload();
  const again = await select(page, 1);
  await expect(again.getByRole("combobox", { name: "Profile" })).toHaveText("vorpal-mg90 rev 3");
  await expect(again.getByRole("combobox", { name: "Policy" })).toHaveText("mg90-d-record rev 1");
  await expect(again.getByRole("button", { name: "Identify" })).toBeEnabled();

  const second = await select(page, 2);
  await expect(second.getByRole("combobox", { name: "Profile" })).toHaveText("Choose a profile");
  await expect(second.getByRole("combobox", { name: "Policy" })).toHaveText("Default");
  await choose(second, "Profile", "vorpal-mg90-new rev 3");
  await expect(second).toContainText("The profile has no gear ratio: open it");
  await expect(second).toContainText(
    "Without the gear ratio the run cannot turn motor turns into horn degrees",
  );
  await expect(second.getByRole("button", { name: "Identify" })).toBeDisabled();

  const first = await select(page, 1);
  await expect(first.getByRole("combobox", { name: "Profile" })).toHaveText("vorpal-mg90 rev 3");
  await expect(first.getByRole("button", { name: "Identify" })).toBeEnabled();

  await page.getByRole("link", { name: "Profiles" }).click();
  const list = page.getByRole("navigation", { name: "Profiles" });
  await expect(list.getByRole("button", { name: /^vorpal-mg90 / })).toContainText("used by ID 1");
  await expect(list.getByRole("button", { name: /^vorpal-mg90-new / })).toContainText(
    "used by ID 2",
  );
});

test("an incomplete profile's open-it link lands on that profile", async ({ page }) => {
  const card = await openServo(page, 2);
  await choose(card, "Profile", "vorpal-mg90-new rev 3");
  await card.getByRole("link", { name: "open it" }).click();
  await expect(page.getByRole("heading", { name: "Servo profiles" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Profiles" }).locator('button[aria-current="true"]'),
  ).toContainText("vorpal-mg90-new");
  await expect(page.getByRole("region", { name: "Profile" })).toContainText(
    "vorpal-mg90-new . revision 3",
  );
});

test("a profile with a blank heat model keeps Identify disabled, in the run's words", async ({
  page,
}) => {
  const card = await openServo(page, 1);
  await choose(card, "Profile", "vorpal-mg90-no-heat rev 3");
  await choose(card, "Policy", "mg90-d-record rev 1");
  await expect(card).toContainText("The profile has no heat model: open it");
  await expect(card).toContainText(
    "The run prices the heat of every drive and writes the winding temperature estimate from the motor's heat model: the profile has no usable thermal",
  );
  await expect(card.getByRole("button", { name: "Identify" })).toBeDisabled();

  await choose(card, "Profile", "vorpal-mg90 rev 3");
  await expect(card.getByRole("button", { name: "Identify" })).toBeEnabled();
});

test("Default with the record's profile is ready, and Copy for this servo makes ID 1's copy", async ({
  page,
}) => {
  const card = await openServo(page, 1);
  await choose(card, "Profile", "vorpal-mg90 rev 3");
  await expect(card.getByRole("combobox", { name: "Policy" })).toHaveText("Default");
  await expect(card.getByRole("button", { name: "Identify" })).toBeEnabled();

  await card.getByRole("button", { name: "Copy for this servo" }).click();
  await expect(card.getByRole("combobox", { name: "Policy" })).toHaveText("default-51ce290f rev 1");
  await expect(card.getByRole("button", { name: "Copy for this servo" })).toBeHidden();
  await expect(card.getByRole("button", { name: "Identify" })).toBeEnabled();
});

test("a policy the run refuses is named in the CLI's words, with a link to it", async ({
  page,
}) => {
  const card = await openServo(page, 1);
  await choose(card, "Profile", "vorpal-mg90 rev 3");
  await choose(card, "Policy", "zero-jump rev 1");
  await expect(card).toContainText(ZERO_JUMP);
  await expect(card.getByRole("button", { name: "Identify" })).toBeDisabled();

  await card.getByRole("link", { name: "Open zero-jump on Tuning policies" }).click();
  await expect(page.getByRole("heading", { name: "Tuning policies" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Policies" }).locator('button[aria-current="true"]'),
  ).toContainText("zero-jump");
});

test("a run voltage over the profile's range warns at setup and does not block", async ({
  page,
}) => {
  const card = await openServo(page, 1);
  await choose(card, "Profile", "vorpal-mg90 rev 3");
  await choose(card, "Policy", "seven-volts rev 1");
  await expect(card).toContainText(
    "The servo would run above the maker's range: the motor heats more and its brushes wear fast.",
  );
  await expect(card.getByRole("button", { name: "Identify" })).toBeEnabled();
});
