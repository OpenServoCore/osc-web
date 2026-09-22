import { expect, test } from "@playwright/test";
import { gotoSim } from "./helpers";

const UID = /^[0-9a-f]{32}$/;
const UID_1 = "c94b8419d1092aec87de5fd151ce290f";
const UID_2 = "30634f42dde2095340c8d84f67f28244";

test("a simulated fleet of two discovers as ids 1 and 2", async ({ page }) => {
  await gotoSim(page, [1, 2]);

  const cards = page.getByRole("link", { name: /^ID \d/ });
  await expect(cards).toHaveCount(2);

  const uids = await page.getByText(UID).allTextContents();
  expect(uids).toHaveLength(2);
  expect(uids[0]).not.toBe(uids[1]);

  await expect(cards.filter({ hasText: UID_1 })).toHaveAccessibleName(/^ID 1\b/);
  await expect(cards.filter({ hasText: UID_2 })).toHaveAccessibleName(/^ID 2\b/);
});
