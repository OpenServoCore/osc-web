import { expect, test, type Locator, type Page } from "@playwright/test";
import { CORE_VERSION } from "./helpers";

// The simulated bootloaders all hold compat_key("osc-dev-v006"): 32-bit FNV-1a.
function compatKey(name: string): number {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(name)) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h;
}

/** A `.bin` ending in the tinyboot tail `[compat u32, version u16]`, 2 bytes past a word. */
function image(version: [number, number, number]): Buffer {
  const len = 1002;
  const bytes = Buffer.alloc(len, 0x5a);
  const [major, minor, patch] = version;
  bytes.writeUInt32LE(compatKey("osc-dev-v006"), len - 6);
  bytes.writeUInt16LE((major << 11) | (minor << 6) | patch, len - 2);
  return bytes;
}

async function openDialog(page: Page, search: string): Promise<Locator> {
  await page.goto(`/?${search}`);
  await expect(page.getByRole("button", { name: /^Connected/ })).toBeVisible();
  await page.getByRole("button", { name: "Update firmware" }).click();
  const dialog = page.getByRole("dialog", { name: "Update firmware" });
  await dialog.getByLabel("Firmware files").setInputFiles({
    name: "osc-9.8.7.bin",
    mimeType: "application/octet-stream",
    buffer: image([9, 8, 7]),
  });
  await expect(dialog.getByText("Version 9.8.7")).toBeVisible();
  await dialog.getByRole("button", { name: "Enter bootloaders" }).click();
  return dialog;
}

function row(dialog: Locator, label: string): Locator {
  return dialog.getByRole("row").filter({ hasText: label });
}

function status(dialog: Locator, label: string, name: string): Locator {
  return row(dialog, label).getByRole("img", { name });
}

test("a matching image installs on two boards and they come back on the new version", async ({
  page,
}) => {
  const dialog = await openDialog(page, "sim=1,2,3&boot=3");
  await expect(row(dialog, "ID 1")).toBeVisible();
  await expect(row(dialog, "ID 2")).toBeVisible();
  await expect(row(dialog, "No app")).toBeVisible();
  await expect(row(dialog, "ID 1")).toContainText(CORE_VERSION);

  await dialog.getByRole("checkbox", { name: /^Update ID 1 / }).click();
  await dialog.getByRole("checkbox", { name: /^Update No app / }).click();
  const table = dialog.getByRole("table");
  const width = (await table.boundingBox())?.width;
  await dialog.getByRole("button", { name: "Flash selected" }).click();
  await expect(status(dialog, "ID 1", "Installed")).toBeVisible();
  await expect(status(dialog, "No app", "Installed")).toBeVisible();
  await expect(status(dialog, "ID 2", "Installed")).toHaveCount(0);
  await expect(dialog.getByRole("progressbar", { name: "Overall" })).toHaveAttribute(
    "aria-valuenow",
    "100",
  );
  expect((await table.boundingBox())?.width).toBe(width);

  await dialog.getByRole("button", { name: "Restart all" }).click();
  const back = (id: number) =>
    dialog
      .getByRole("region", { name: "Back on the bus" })
      .getByRole("listitem")
      .filter({ hasText: `ID ${id}` });
  await expect(back(1)).toContainText("9.8.7");
  await expect(back(1)).toContainText("new");
  await expect(back(3)).toContainText("9.8.7");
  await expect(back(2)).toContainText(CORE_VERSION);
  await expect(back(2)).not.toContainText("new");

  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "ID 3" })).toBeVisible();
});

test("after Enter the dialog stays open and a failed board still waits after Restart all", async ({
  page,
}) => {
  const dialog = await openDialog(page, "sim=1,2&fail=1:write");
  await expect(row(dialog, "ID 1")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText(
      "1 or more servos are still in bootloader mode. Exiting now will leave them stuck in this mode.",
    ),
  ).toBeVisible();

  await dialog.getByRole("checkbox", { name: /^Update ID 1 / }).click();
  await dialog.getByRole("checkbox", { name: /^Update ID 2 / }).click();
  await dialog.getByRole("button", { name: "Flash selected" }).click();
  await expect(status(dialog, "ID 1", "The board could not write its flash")).toBeVisible();
  await expect(status(dialog, "ID 2", "Installed")).toBeVisible();
  await expect(dialog.getByRole("progressbar", { name: "Overall" })).toHaveAttribute(
    "aria-valuenow",
    "100",
  );

  await dialog.getByRole("button", { name: "Restart all" }).click();
  const waiting = dialog.getByRole("region", { name: "Waiting for firmware" });
  await expect(waiting).toContainText("ID 1");
  await expect(dialog.getByRole("region", { name: "Back on the bus" })).toContainText("ID 2");
  await expect(dialog.getByRole("region", { name: "Back on the bus" })).not.toContainText("ID 1");
});

test("a lost adapter unlocks the dialog and hands over to Reconnect", async ({ page }) => {
  const dialog = await openDialog(page, "sim=1,2");
  await expect(row(dialog, "ID 1")).toBeVisible();

  await page.evaluate(() => {
    (window as unknown as { __osc: { sever: () => void } }).__osc.sever();
  });
  await expect(
    dialog.getByText(
      "The adapter disconnected. 1 or more servos may still be in bootloader mode: reconnect and restart them from Update firmware.",
    ),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Restart all" })).toBeHidden();

  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Connection lost" }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Reconnect" })).toBeVisible();
});
