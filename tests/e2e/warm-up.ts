import { chromium, type FullConfig } from "@playwright/test";

// A route's first request makes the dev server transform its whole module
// graph; under load that outlasts a spec's 5 s expect, so it is paid here once.
const ROUTES = [
  ["/", "Dashboard"],
  ["/servo", "Pick a servo in the left pane."],
  ["/table", "Control table"],
  ["/live", "Live"],
] as const;

export default async function warmUp(config: FullConfig): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ baseURL: config.projects[0]?.use.baseURL });
    for (const [path, text] of ROUTES) {
      await page.goto(`${path}?sim=1`);
      await page.getByRole("main").getByText(text, { exact: true }).waitFor({ timeout: 60_000 });
    }
  } finally {
    await browser.close();
  }
}
