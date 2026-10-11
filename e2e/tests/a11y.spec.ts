import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * T-017: axe on the component gallery and the storefront home page (T-016: and /account), against the production build
 * (playwright.smoke.config.ts). Serious or critical violations fail; minor/moderate are listed.
 */
const pages = [
  ["web /nl", "http://localhost:3000/nl"],
  ["platform /dev/ui", "http://localhost:3001/dev/ui"],
  ["platform /account (signed out)", "http://localhost:3001/account"],
] as const;

for (const [name, url] of pages) {
  test(`axe: ${name} has no serious or critical violations`, async ({ page }) => {
    await page.goto(url, { waitUntil: "networkidle" });
    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
      .analyze();

    const summary = violations.map(
      (v) => `${v.impact ?? "unknown"} ${v.id}: ${v.nodes.length} node(s)`,
    );
    if (summary.length > 0) console.info(`${name} axe findings:\n  ${summary.join("\n  ")}`);

    const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(blocking.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
}
