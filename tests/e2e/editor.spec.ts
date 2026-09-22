import { expect, test } from "@playwright/test";

test("number editor validates, applies and shows the new value", async ({ page }) => {
  await page.goto("/servo");
  await page.getByRole("button", { name: "1", exact: true }).click();
  const input = page.getByRole("textbox");
  await input.fill("250");
  await expect(page.getByText("between 1 and 249")).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply" })).toBeDisabled();
  await input.fill("42");
  await expect(page.getByText("between 1 and 249")).toBeHidden();
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("button", { name: "42", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "1", exact: true })).toBeHidden();
});

test("bool editor flips the label", async ({ page }) => {
  await page.goto("/servo");
  await page.getByRole("button", { name: "Off", exact: true }).click();
  await page.getByRole("switch").click();
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("button", { name: "On", exact: true })).toBeVisible();
});

test("enum editor applies the picked option", async ({ page }) => {
  await page.goto("/servo");
  await page.getByRole("button", { name: "Position", exact: true }).click();
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: "Velocity" }).click();
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("button", { name: "Velocity", exact: true })).toBeVisible();
});
