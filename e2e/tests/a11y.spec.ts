import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * T-017: axe on the component gallery and the storefront home page (T-016: and /account), against the production build
 * (playwright.smoke.config.ts). Serious or critical violations fail; minor/moderate are listed.
 */
const pages = [
  ["web /nl", "http://localhost:3000/nl"],
  ["web /fr", "http://localhost:3000/fr"],
  ["web legal page", "http://localhost:3000/en/legal/privacy"],
  ["web 404", "http://localhost:3000/de/nope"],
  ["platform /dev/ui", "http://localhost:3001/dev/ui"],
  ["platform /account (signed out)", "http://localhost:3001/account"],
  ["platform /sign-in", "http://localhost:3001/sign-in"],
  ["platform /setup (signed out)", "http://localhost:3001/setup"],
  ["platform /enrol (no link)", "http://localhost:3001/enrol"],
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

// #223: exercise the actual server-rendered table component without customer data or staff login.
for (const width of [320, 639, 640, 1280]) {
  for (const theme of ["light", "dark"]) {
    test(`responsive back-office table: ${width}px, ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("http://localhost:3001/dev/ui");
      await page.evaluate((value) => {
        document.documentElement.dataset["theme"] = value;
      }, theme);
      const table = page.getByRole("table", { name: "Demo orders" });
      await expect(table).toHaveClass(/align-top/);
      await expect(table.getByRole("columnheader")).toHaveCount(4);
      await expect(table.getByRole("row")).toHaveCount(3);
      await expect(table.getByRole("cell")).toHaveCount(8);
      const row = table.locator("tbody tr").first();
      await expect(row).toContainText("DemoCustomerWithAVeryLongUnbrokenNameToCheckNarrowScreens");
      await expect(row).toContainText("Refund due");
      const labels = row.locator(".responsive-table-label");
      if (width < 640) {
        await expect(labels.first()).toBeVisible();
      } else {
        await expect(labels.first()).toBeHidden();
      }
      expect(await row.evaluate((element) => getComputedStyle(element).display)).toBe(
        width < 640 ? "block" : "table-row",
      );
      expect(await table.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      expect(
        await table.evaluate((element) => element.getBoundingClientRect().right <= innerWidth),
      ).toBe(true);
      const link = table.getByRole("link", { name: "IGS-DEMO-000001" });
      await link.focus();
      await expect(link).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/#responsive-table-target$/);
      const { violations } = await new AxeBuilder({ page })
        .include("[data-testid=responsive-table-demo]")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual(
        [],
      );
      await table.screenshot({ path: testInfo.outputPath(`table-${width}-${theme}.png`) });
    });
  }
}
