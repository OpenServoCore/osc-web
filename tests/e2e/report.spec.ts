import { expect, test, type Page } from "@playwright/test";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const UID = "00000000ffffffff76e5bc220ef6abcd";
const UTC = "20261127T130203Z";
const FIXTURE = fileURLToPath(
  new URL(`../../../open-servo-core/measure/testdata/run/${UID}/${UTC}`, import.meta.url),
);

async function openReport(page: Page, folder: string): Promise<void> {
  await page.goto("/runs?sim=1");
  await expect(page.getByRole("heading", { name: "Identification runs" })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByLabel("Run folder").setInputFiles(folder);
  await expect(page.getByRole("status")).toContainText("Opened the run");
  await page.getByRole("link", { name: "Open the report" }).click();
  await expect(page.getByRole("heading", { name: "Identification report" })).toBeVisible();
}

function tile(page: Page, name: string) {
  return page
    .getByRole("region", { name: "Headline numbers" })
    .getByRole("group", { name, exact: true });
}

test("a recorded run's report shows its measured values with their spread, the move scores and the inputs", async ({
  page,
}) => {
  await openReport(page, FIXTURE);
  await expect(page.getByRole("region", { name: "Run" })).toContainText(
    "profile mg90-d rev 0 . policy policy rev 0 . board facts read from the servo . osc-ident 0.1.0 . 5 min 45 s . through the final check",
  );

  await expect(tile(page, "Travel")).toContainText("184.04 deg");
  await expect(tile(page, "Winding resistance")).toContainText("4.0988 ohm+/- 0.0446, n 36");
  await expect(tile(page, "Winding resistance at 25 C")).toContainText(
    "4.1599 ohm+/- 0.0453, n 36",
  );
  await expect(tile(page, "Motor constant Ke")).toContainText(
    "1.1577e-3 V s/rad+/- 7.5884e-6, n 11",
  );
  await expect(tile(page, "Inertia J")).toContainText("6.5849e-9 kg m^2+/- 2.6168e-10, n 6");
  await expect(tile(page, "Free speed at 5 V")).toContainText("803.2716 deg/s+/- 5.2651, n 11");
  await expect(tile(page, "Friction at a slow move")).toContainText("37.5980 mA+/- 0.4511, n 14");
  const check = tile(page, "Move check");
  await expect(check).toContainText(
    "12 movesworst overshoot 0.92 deg (33% + out), worst rest error 0.36 deg (1% - out)",
  );
  await expect(check).toContainText("at v_kp_q88 50, the tune's try 7");
  await expect(tile(page, "Longest position hole")).toContainText(
    "5.63 deg112.1 counts at raw 6.75..118.80; 1 hole listed",
  );
  await expect(tile(page, "Widest ADC wide code")).toContainText(
    "11 codes0.55 deg at raw 2048..2058; 11 listed",
  );

  await page.getByRole("button", { name: "Show as table" }).click();
  const marks = page.getByRole("table", { name: "Travel map as a table" });
  await expect(marks.getByRole("row").filter({ hasText: "position hole" })).toContainText(
    "6.75118.80",
  );

  const scores = page.getByRole("list", { name: "Move scores" });
  await expect(page.getByRole("combobox", { name: "Move" })).toContainText("10% + out");
  await expect(scores).toContainText("Overshoot: 0.59 deg");
  await expect(scores).toContainText("Rest error: 0.15 deg");

  await expect(page.getByLabel("Friction line")).toContainText(
    "Line 37.5980 mA + 0.2608 mA per deg/s, rms 1.0407 mA over 14 legs.",
  );

  const inputs = page.getByRole("region", { name: "Inputs" });
  await expect(inputs).toContainText("Move speed200 deg/s");
  const checks = inputs.getByRole("table", { name: "Cross-checks" });
  await expect(checks.getByRole("row").filter({ hasText: /^travel/ })).toContainText(
    "183.0071 deg +/- 0.0117, n 3180.0000 deg+1.67 %",
  );
  await expect(checks.getByRole("row").filter({ hasText: /^pacing/ })).toContainText(
    "19.9094 counts/deg n 122.7556 counts/deg-12.51 %",
  );
  await expect(
    checks.getByRole("row").filter({ hasText: "free speed at 4.8 V, V / Ke" }),
  ).toContainText("771.1407 deg/s +/- 5.0545, n 11600.0000 deg/s+28.52 %");
  await expect(
    checks.getByRole("row").filter({ hasText: "stall current at 4.8 V, V / R" }),
  ).toContainText("1.1711 A +/- 0.0127, n 36states none");

  await expect(page.getByRole("region", { name: "Store the final set" })).toContainText(
    `osc-ident --id <bus id> save --set ${UID}/${UTC}/final/set.json --table ${UID}/${UTC}/final/inputs/pos_lut.json`,
  );
  // The report's own numbers carry no verdict; the tool's words appear only where it wrote them.
  const verdict = /\bpass\b|\bfail\b|warning/i;
  await expect(page.getByRole("region", { name: "Headline numbers" })).not.toContainText(verdict);
  await expect(checks).not.toContainText(verdict);
});

test("a run that stopped at the probe says why and shows no card past it", async ({
  page,
}, info) => {
  const folder = info.outputPath(UTC);
  cpSync(FIXTURE, folder, { recursive: true });
  const path = join(folder, "run.json");
  const run = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown> & {
    steps: Record<string, unknown>;
  };
  const why = "the bridge drives one sign only: the motor may be open";
  const steps = run.steps as Record<string, Record<string, unknown>>;
  run.steps = {
    rest: steps.rest,
    probe: { ...steps.probe, state: "refused", why },
  };
  const notRun = { state: "not run", why: "not every step was accepted" };
  for (const entry of ["gather", "tune", "cruise", "final"]) run[entry] = notRun;
  writeFileSync(path, JSON.stringify(run, null, 2));

  await openReport(page, folder);
  await expect(page.getByLabel("Where the run stopped")).toHaveText(
    `The run stopped at the probe (refused): ${why}`,
  );
  await expect(page.getByRole("region", { name: "Travel map" })).toContainText(
    "The run did not reach the table.",
  );
  await expect(page.getByRole("region", { name: "Move response" })).toContainText(
    "The run did not reach the final check.",
  );
  await expect(page.getByRole("region", { name: "Inputs" })).toContainText(
    "The run did not reach the gather.",
  );
});

// The recorded run's set as identification writes it: the map about the
// center of travel, the set's center block beside it.
test("a set with 0 deg at the center reads the arc in its degrees and says where 0 deg is", async ({
  page,
}) => {
  await openReport(page, FIXTURE);
  await expect(tile(page, "Travel")).toContainText("184.04 deg");
  await expect(tile(page, "Travel")).toContainText(
    "0 deg at the center of travel, 1926.8 counts, raw 1935.8",
  );
  const arc = page.getByRole("region", { name: "Travel map" }).getByRole("img", {
    name: "Position sensor over 184.0 degrees: 1 position hole, the longest 112.1 counts (5.63 degrees) from -96.4 to -90.8 degrees; 10 ADC wide codes, the widest 11 codes at 4.9 degrees; 0.73 to 1.31 times the average resolution across 90 % of the judged travel.",
  });
  await expect(arc).toBeVisible();
  await expect(arc).toContainText("CW stop -92.0 deg");
  await expect(arc).toContainText("CCW stop 92.1 deg");
  for (const tick of ["-60 deg", "-30 deg", "0 deg", "30 deg", "60 deg"]) {
    await expect(arc.getByText(tick, { exact: true })).toBeVisible();
  }
});
