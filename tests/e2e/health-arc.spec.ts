import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

const UID = "00000000ffffffff76e5bc220ef6abcd";
const UTC = "20261127T130203Z";
const FIXTURE = fileURLToPath(
  new URL(`../../../open-servo-core/measure/testdata/run/${UID}/${UTC}`, import.meta.url),
);

async function openArc(page: Page) {
  await page.goto("/runs?sim=1");
  await expect(page.getByRole("heading", { name: "Identification runs" })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByLabel("Run folder").setInputFiles(FIXTURE);
  await expect(page.getByRole("status")).toContainText("Opened the run");
  await page.getByRole("link", { name: "Open the report" }).click();
  const card = page.getByRole("region", { name: "Travel map" });
  const arc = card.getByRole("img", { name: /^Position sensor over/ });
  await expect(arc).toBeVisible();
  return { card, arc, pane: card.getByRole("tooltip", { name: "Mark details" }) };
}

test("the arc spans the recorded travel with the pot hole hatched red at the CW stop", async ({
  page,
}) => {
  const { arc, pane } = await openArc(page);
  await expect(arc).toHaveAttribute(
    "aria-label",
    "Position sensor over 187.0 degrees: 1 position hole, the longest 112.1 counts (5.63 degrees) from 0.0 to 5.7 degrees; 10 ADC wide codes, the widest 11 codes at 101.2 degrees; 0.73 to 1.31 times the average resolution across 90 % of the judged travel.",
  );
  await expect(arc).toContainText("CW stop 0°");
  await expect(arc).toContainText("CCW stop 187.0°");
  await expect(arc).toContainText("112.1 counts (5.63°) at raw 6.75..118.80");

  const hole = arc.locator('[data-kind="pot"]');
  await expect(hole).toHaveAttribute("data-raw", /^6\.75\d*\.\.118\.80\d*$/);
  const ink = await hole.evaluate((g) => {
    const [, stripes] = Array.from(g.querySelectorAll("path"));
    const id = /url\(#(.+)\)/.exec(stripes?.getAttribute("fill") ?? "")?.[1] ?? "";
    const line = document.getElementById(id)?.querySelector("line");
    return {
      outline: stripes === undefined ? "" : getComputedStyle(stripes).stroke,
      stripes: line === null || line === undefined ? "" : getComputedStyle(line).stroke,
      angle: document.getElementById(id)?.getAttribute("patternTransform"),
    };
  });
  expect(ink).toEqual({
    outline: "rgb(158, 34, 37)",
    stripes: "rgb(158, 34, 37)",
    angle: "rotate(45)",
  });

  await arc.scrollIntoViewIfNeeded();
  const svgBox = await arc.boundingBox();
  const holeBox = await hole.boundingBox();
  if (svgBox === null || holeBox === null) throw new Error("not laid out");
  // The CW stop, the low end of the counts, is on the right.
  expect(holeBox.x).toBeGreaterThan(svgBox.x + svgBox.width / 2);
  await page.mouse.move(holeBox.x + holeBox.width / 2, holeBox.y + holeBox.height / 2);
  await expect(pane).toContainText("Position hole");
  await expect(pane).toContainText("0.0° to 5.7°, 112.1 counts (5.63°)");
  await expect(pane).toContainText("raw 6.75..118.80");
  await expect(pane).toContainText("the motor turned 5 ripple cycles (0.97° at the horn)");
  await expect(pane).toContainText("seen on passes 1, 3, 5 and 7, with the counts falling");
  await expect(pane).toContainText("a hole where they run over 6.89× typical (1 + 4 × 1.47)");
});

test("the converter's wide codes are violet ticks at the carries", async ({ page }) => {
  const { arc, pane } = await openArc(page);
  const ticks = arc.locator('[data-kind="adc"]');
  await expect(ticks).toHaveCount(10);
  const seen = await ticks.evaluateAll((els) =>
    els.map((el) => {
      const s = getComputedStyle(el);
      return [el.getAttribute("data-carry"), el.getAttribute("data-stored"), s.fill, s.stroke];
    }),
  );
  const violet = "rgb(139, 92, 246)";
  expect(seen).toEqual(
    [255, 511, 1023, 1279, 2047, 2303, 2559, 3071, 3327, 3583].map((c) => {
      const stored = [511, 1023, 2047, 2559].includes(c);
      return [String(c), stored ? "yes" : "no", stored ? violet : "none", violet];
    }),
  );
  await arc.scrollIntoViewIfNeeded();
  const widest = await arc.locator('[data-carry="2047"]').boundingBox();
  if (widest === null) throw new Error("not laid out");
  await page.mouse.move(widest.x + widest.width / 2, widest.y + widest.height / 2);
  await expect(pane).toContainText("ADC wide code above 2047");
  await expect(pane).toContainText("101.2°, raw 2048..2058, 11 codes (0.55°)");
  await expect(pane).toContainText(
    "The stored slot reads the stuck code as the middle of the gap.",
  );
  await expect(pane).toContainText("the run starts just above carry 2047");
});

test("the keyboard steps the pane through the marks in angle order", async ({ page }) => {
  const { arc, pane } = await openArc(page);
  await arc.focus();
  await page.keyboard.press("Home");
  await expect(pane).toContainText("No wide code judged");
  await expect(pane).toContainText("No slow pass crossed these codes.");
  await page.keyboard.press("ArrowLeft");
  await expect(pane).toContainText("Position hole");
  await page.keyboard.press("ArrowLeft");
  await expect(pane).toContainText(
    "The passes turn here, so no wide code is judged within 15 counts of a turn.",
  );
  await page.keyboard.press("ArrowLeft");
  await expect(pane).toContainText("counts a degree here");
  await page.keyboard.press("ArrowLeft");
  await expect(pane).toContainText("ADC wide code above 255");
  await page.keyboard.press("ArrowRight");
  await expect(pane).toContainText("counts a degree here");
  await page.keyboard.press("End");
  await expect(pane).toContainText("No slow pass crossed these codes.");
  await expect(pane).toContainText("187.0°");
  await page.keyboard.press("Escape");
  await expect(pane).toBeHidden();
});

test("the table view lists every mark and the resolution every 10 deg", async ({ page }) => {
  const { card } = await openArc(page);
  await card.getByRole("button", { name: "Show as table" }).click();
  const rows = card.getByRole("table", { name: "Travel map as a table" }).getByRole("row");
  await expect(rows.filter({ hasText: "position hole" })).toHaveText(
    "position hole0.045.656.75118.80112.15.63°",
  );
  await expect(rows.filter({ hasText: /^ADC wide code/ })).toHaveCount(10);
  await expect(rows.filter({ hasText: "above carry 2047" })).toContainText("2048205811");
  await expect(rows.filter({ hasText: "no wide code judged" })).toHaveCount(4);
  await expect(rows.filter({ hasText: /^resolution/ })).toHaveCount(18);
});
