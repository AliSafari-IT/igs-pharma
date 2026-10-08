import { type Page, expect, test } from "@playwright/test";

/**
 * T-015: the styling pipeline works in the production build and the CSP blocks nothing on the page.
 * Run with `pnpm --filter @igs/e2e smoke` after `pnpm build` (see playwright.smoke.config.ts).
 */

/** Collects CSP violations reported for the page itself. */
async function watchCsp(page: Page): Promise<string[]> {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("Content Security Policy")) violations.push(message.text());
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) =>
      console.error(`Content Security Policy violation: ${event.violatedDirective}`),
    );
  });
  return violations;
}

/** --color-primary resolved by the browser, as an rgb() string. */
const primaryColor = (page: Page) =>
  page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--color-primary)";
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });

test("web /nl: Tailwind utilities, primary heading, Inter, no CSP violations", async ({ page }) => {
  const violations = await watchCsp(page);
  await page.goto("http://localhost:3000/nl", { waitUntil: "networkidle" });

  const main = page.locator("main");
  await expect(main).toHaveCSS("display", "flex"); // a utility from the generated stylesheet
  await expect(main).toHaveCSS("min-height", "720px"); // min-h-screen at the default viewport
  await expect(page.locator("h1")).toHaveCSS("color", await primaryColor(page));
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toMatch(/^"?Inter/);
  expect(violations).toEqual([]);
});

test("platform /: Tailwind utilities, primary heading, no CSP violations", async ({ page }) => {
  const violations = await watchCsp(page);
  await page.goto("http://localhost:3001/", { waitUntil: "networkidle" });

  await expect(page.locator("main")).toHaveCSS("padding", "32px"); // p-8
  await expect(page.locator("h1")).toHaveCSS("color", await primaryColor(page));
  expect(violations).toEqual([]);
});
