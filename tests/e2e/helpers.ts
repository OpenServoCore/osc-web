import { expect, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/** The table nb09 built for the bench MG90, as osc lut write takes it. */
export const MG90A = JSON.parse(
  readFileSync(
    new URL(
      "../../../open-servo-core/ident/testdata/lut/pos-lut-mg90-a-grid.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { points: number[] };

/** The core crate's version: the simulated fleet stamps it into firmware_version. */
export const CORE_VERSION = coreVersion();

function coreVersion(): string {
  const toml = readFileSync(
    new URL("../../../open-servo-core/firmware/lib/core/Cargo.toml", import.meta.url),
    "utf8",
  );
  const version = /^version\s*=\s*"(\d+\.\d+\.\d+)"/m.exec(toml)?.[1];
  if (version === undefined) throw new Error("no version in the core Cargo.toml");
  return version;
}

interface SimWindow {
  __osc?: { writePosLut: (id: number, points: number[]) => Promise<void> };
}

/** Puts a table into simulated servo `id` the way osc lut write does: STORE, COMMIT, readback. */
export async function writeTable(page: Page, id: number, points: number[]): Promise<void> {
  await page.evaluate(([id, points]) => (window as SimWindow).__osc?.writePosLut(id, points), [
    id,
    points,
  ] as const);
}

/** Holds every descriptor request until the returned release is called. */
export async function holdDescriptors(page: Page): Promise<() => void> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/descriptors/**", async (route) => {
    await released;
    await route.continue();
  });
  return release;
}

/** Lands on the home page with a simulated fleet of `ids` already scanned. */
export async function gotoSim(
  page: Page,
  ids: number[],
  opts: { debug?: boolean } = {},
): Promise<void> {
  await page.goto(`/?sim=${ids.join(",")}${opts.debug === true ? "&debug" : ""}`);
  await expect(page.getByRole("button", { name: /^Connected/ })).toBeVisible();
}

/** Migrates the simulated fleet from its factory 1 M through the connection popover. */
export async function setSpeed(page: Page, speed: string): Promise<void> {
  await page.getByRole("button", { name: /^Connected/ }).click();
  const popover = page.getByRole("dialog");
  await popover.getByRole("combobox", { name: "Speed" }).click();
  await page.getByRole("option", { name: speed }).click();
  await popover.getByRole("button", { name: "Apply" }).click();
  await popover.getByRole("button", { name: "Change speed" }).click();
  await expect(page.getByRole("button", { name: `Connected at ${speed}` })).toBeVisible();
  await page.keyboard.press("Escape");
}

/** Selects ID 1 of a simulated fleet of 1 and 2 and opens the control table. */
export async function openTable(page: Page): Promise<void> {
  await gotoSim(page, [1, 2]);
  await page.getByRole("button", { name: "ID 1" }).click();
  await page.getByRole("link", { name: "Control table" }).click();
  // A cold dev server compiles the route chunk on this first request.
  await expect(page.getByRole("tab", { name: "Settings" })).toBeVisible({ timeout: 15_000 });
}

/** The control table row whose register name is `name`. */
export function tableRow(page: Page, name: string): Locator {
  return page.getByRole("row").filter({ has: page.getByText(name, { exact: true }) });
}
