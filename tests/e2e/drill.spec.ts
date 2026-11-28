import { expect, test, type Locator, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

const UID = "00000000ffffffff76e5bc220ef6abcd";
const UTC = "20261127T130203Z";
const FIXTURE = fileURLToPath(
  new URL(`../../../open-servo-core/measure/testdata/run/${UID}/${UTC}`, import.meta.url),
);

async function openReport(page: Page): Promise<void> {
  await page.goto("/runs?sim=1");
  await expect(page.getByRole("heading", { name: "Identification runs" })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByLabel("Run folder").setInputFiles(FIXTURE);
  await expect(page.getByRole("status")).toContainText("Opened the run");
  await page.getByRole("link", { name: "Open the report" }).click();
  await expect(page.getByRole("heading", { name: "Identification report" })).toBeVisible();
}

async function drillFromReport(page: Page, title: string): Promise<void> {
  await page
    .getByRole("navigation", { name: "Step data" })
    .getByRole("link", { name: new RegExp(`^${title} `) })
    .click();
  await expect(page.getByRole("heading", { name: `${title} data` })).toBeVisible({
    timeout: 15_000,
  });
}

function row(table: Locator, first: string): Locator {
  return table
    .getByRole("row")
    .filter({ has: table.page().getByRole("cell", { name: first, exact: true }) });
}

/** An estimate's value, spread, n and unit cells. */
async function expectEstimate(
  page: Page,
  name: string,
  cells: [value: string, sd: string, n: string, unit: string],
): Promise<void> {
  const r = row(page.getByRole("table", { name: "Estimates" }), name).getByRole("cell");
  for (const [i, text] of cells.entries()) await expect(r.nth(i + 1)).toHaveText(text);
}

test("each step's drill-in opens from the report and shows its numbers", async ({ page }) => {
  test.setTimeout(120_000);
  await openReport(page);
  const back = async () => {
    await page.getByRole("link", { name: "Back to the report" }).click();
    await expect(page.getByRole("heading", { name: "Identification report" })).toBeVisible();
  };

  await drillFromReport(page, "Rest");
  await expect(page.getByRole("region", { name: "Step" })).toContainText("run.json: accepted, 2 s");
  await expectEstimate(page, "current_zero_asleep_counts", [
    "1206.3857",
    "+/- 1.0418",
    "20000",
    "counts",
  ]);
  await expect(
    row(page.getByRole("table", { name: "Channel statistics" }), "rest").first(),
  ).toContainText("pos200001902.1364");
  await back();

  await drillFromReport(page, "Probe");
  await expectEstimate(page, "r_plan_free_ohm", ["4.5001", "", "112", "ohm"]);
  await expect(page.getByRole("table", { name: "Bursts" }).getByRole("row")).toHaveCount(17);
  await back();

  await drillFromReport(page, "Stops");
  await expectEstimate(page, "r_seated_ohm", ["4.0988", "+/- 0.0446", "36", "ohm"]);
  await expectEstimate(page, "r_seated_25c_ohm", ["4.1599", "+/- 0.0453", "36", "ohm"]);
  await expect(page.getByLabel("Bursts kept")).toHaveText("36 of 48 bursts kept.");
  const seatChecks = page.getByRole("table", { name: "Checks" });
  await expect(row(seatChecks, "each stop's seats agree").getByRole("cell")).toHaveText([
    "each stop's seats agree",
    "low 6, 6, 6 (0 apart); high 3737, 3737, 3738 (1 apart)",
    "3 seats each, within 10 counts",
    "pass",
  ]);
  await back();

  await drillFromReport(page, "Table");
  await expectEstimate(page, "pot_step4_counts", ["5.0000", "", "30", "raw counts"]);
  await expect(row(page.getByRole("table", { name: "Checks" }), "table residual")).toContainText(
    "2.96 counts rms",
  );
  await expect(page.getByRole("table", { name: "Table scale" })).toContainText(
    "scale.counts_per_deg19.9094",
  );
  await back();

  await drillFromReport(page, "Window");
  await expectEstimate(page, "g_window_ms", ["3.9795", "+/- 0.0653", "22", "mS"]);
  await expect(page.getByLabel("Residual count")).toHaveText(
    "12 residuals over 12 window lengths.",
  );
  await back();

  await drillFromReport(page, "Spins");
  await expectEstimate(page, "ke_v_s_per_rad", ["1.1577e-3", "+/- 7.5884e-6", "11", "V s/rad"]);
  await expectEstimate(page, "j_kg_m2", ["6.5849e-9", "+/- 2.6168e-10", "6", "kg m^2"]);
  await expect(page.getByRole("table", { name: "Coasts" }).getByRole("row")).toHaveCount(15);
  await back();

  await drillFromReport(page, "Tune");
  const tries = page.getByRole("table", { name: "Tries" });
  const want: [string, string, string, string][] = [
    ["1", "tune", "153", "refused"],
    ["2", "tune", "123", "refused"],
    ["3", "tune", "98", "refused"],
    ["4", "tune", "79", "refused"],
    ["5", "tune", "63", "refused"],
    ["6", "tune", "50", "accepted"],
    ["7", "back-off", "50", "accepted"],
  ];
  await expect(tries.getByRole("row")).toHaveCount(want.length + 1);
  for (const [n, from, vKp, word] of want) {
    const cells = row(tries, n).getByRole("cell");
    await expect(cells.nth(1)).toHaveText(from);
    await expect(cells.nth(2)).toHaveText(vKp);
    await expect(cells.nth(5)).toHaveText(word);
  }
  await expect(row(tries, "1").getByRole("cell").nth(6)).toHaveText("rest error");
  await expect(page.getByLabel("Accepted try")).toHaveText(
    "The run ended on try 7, at v_kp_q88 50.",
  );
  await expect(page.getByRole("combobox", { name: "Try" })).toContainText("try 7, v_kp_q88 50");
  await expect(row(page.getByRole("table", { name: "Move scores" }), "10% + out")).toContainText(
    "10% + out",
  );
  await back();

  await drillFromReport(page, "Cruise");
  await expectEstimate(page, "friction_coulomb_ma", ["37.5980", "+/- 0.4511", "14", "mA"]);
  await expect(page.getByRole("table", { name: "Legs" }).getByRole("row")).toHaveCount(17);
  await back();

  await drillFromReport(page, "Final check");
  await expect(page.getByRole("region", { name: "Estimates" })).toContainText(
    "final/results/verify.json writes no estimates.",
  );
  const scores = page.getByRole("table", { name: "Move scores" });
  await expect(scores.getByRole("row")).toHaveCount(13);
  await expect(row(scores, "10% + out")).toContainText("0.5889");
  await expect(
    row(page.getByRole("table", { name: "Checks" }), "the first enable holds still"),
  ).toContainText("pass");
  await expect(
    page.getByRole("group", { name: "Move 10% + out" }).locator("canvas"),
  ).not.toHaveCount(0);
});

test("a headline tile opens the step whose data is behind it", async ({ page }) => {
  await openReport(page);
  const tiles = page.getByRole("region", { name: "Headline numbers" });
  await tiles.getByRole("group", { name: "Winding resistance at 25 C" }).getByRole("link").click();
  await expect(page.getByRole("heading", { name: "Stops data" })).toBeVisible({ timeout: 15_000 });
  await expectEstimate(page, "r_seated_25c_ohm", ["4.1599", "+/- 0.0453", "36", "ohm"]);

  await page.getByRole("link", { name: "Back to the report" }).click();
  await tiles.getByRole("group", { name: "Motor constant Ke" }).getByRole("link").click();
  await expect(page.getByRole("heading", { name: "Spins data" })).toBeVisible({ timeout: 15_000 });
  await expectEstimate(page, "ke_v_s_per_rad", ["1.1577e-3", "+/- 7.5884e-6", "11", "V s/rad"]);
});

test("a capture trimmed out of the folder says so, and a kept one opens its rows", async ({
  page,
}) => {
  await openReport(page);
  await drillFromReport(page, "Probe");
  const captures = page.getByRole("list", { name: "Capture list" });
  await expect(captures.getByRole("listitem", { name: "02-raw", exact: true })).toContainText(
    "Trimmed: the run folder does not hold captures/probe/02-raw.csv.gz; its 02-raw.meta.json is.",
  );
  await expect(captures.getByRole("listitem", { name: "burst-1", exact: true })).toContainText(
    "Trimmed: the run folder does not hold captures/probe/burst-1.csv; its burst-1.meta.json is.",
  );

  const kept = captures.getByRole("listitem", { name: "01-raw", exact: true });
  await kept.getByRole("button", { name: "Open rows" }).click();
  const rows = kept.getByRole("table", { name: "Rows of 01-raw.csv.gz" });
  await expect(rows.getByRole("columnheader", { name: "pos", exact: true })).toBeVisible();
  await expect(kept).toContainText(/All \d+ rows\.|The first 2000 of \d+ rows\./);
  await expect(kept.getByRole("button", { name: "Download 01-raw.csv.gz" })).toBeVisible();
});
