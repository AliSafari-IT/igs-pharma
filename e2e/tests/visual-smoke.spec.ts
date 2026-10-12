import { type Page, expect, test } from "@playwright/test";

/**
 * T-015: the styling pipeline works in the production build and the CSP blocks nothing on the page.
 * T-017: Inter and Fraunces are self-hosted (no request leaves the origin) and the /dev/ui gallery renders.
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

/** Every request the page makes; fonts included, none may leave the app's origin (T-017). */
function watchRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (request) => urls.push(request.url()));
  return urls;
}

const offOrigin = (urls: string[], origin: string) => urls.filter((url) => !url.startsWith(origin));

/** Font families the browser actually loaded (next/font names them "inter" / "fraunces"). */
const loadedFonts = (page: Page) =>
  page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family);
  });

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
  const requests = watchRequests(page);
  await page.goto("http://localhost:3000/nl", { waitUntil: "networkidle" });

  // the storefront shell (igs-pharma#62): utilities from the generated stylesheet
  const shell = page.getByTestId("shell");
  await expect(shell).toHaveCSS("display", "flex");
  await expect(shell).toHaveCSS("min-height", "720px"); // min-h-screen at the default viewport
  await expect(page.locator("h1")).toHaveCSS("color", await primaryColor(page));
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toMatch(/^"?inter/);
  await expect(page.locator("h1")).toHaveCSS("font-family", /^"?fraunces/);
  expect(await loadedFonts(page)).toEqual(expect.arrayContaining(["inter", "fraunces"]));
  expect(offOrigin(requests, "http://localhost:3000/")).toEqual([]);
  expect(violations).toEqual([]);
});

test("platform /api/health/live: 200 without a session, no redirect, security headers (#48)", async ({
  request,
}) => {
  const response = await request.get("http://localhost:3001/api/health/live", { maxRedirects: 0 });
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
});

test("platform /: Tailwind utilities, primary heading, Inter, no CSP violations", async ({
  page,
}) => {
  const violations = await watchCsp(page);
  const requests = watchRequests(page);
  await page.goto("http://localhost:3001/", { waitUntil: "networkidle" });

  await expect(page.locator("main")).toHaveCSS("padding", "32px"); // p-8
  await expect(page.locator("h1")).toHaveCSS("color", await primaryColor(page));
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toMatch(/^"?inter/);
  expect(offOrigin(requests, "http://localhost:3001/")).toEqual([]);
  expect(violations).toEqual([]);
});

test("platform /dev/ui: the component gallery renders with both fonts, no CSP violations", async ({
  page,
}) => {
  const violations = await watchCsp(page);
  const requests = watchRequests(page);
  const res = await page.goto("http://localhost:3001/dev/ui", { waitUntil: "networkidle" });

  expect(res?.status()).toBe(200);
  await expect(page.locator("h1")).toHaveText("UI gallery");
  await expect(page.locator("h1")).toHaveCSS("font-family", /^"?fraunces/);
  await expect(page.getByRole("button", { name: "Primary" })).toHaveCSS(
    "background-color",
    await primaryColor(page),
  );
  await expect(page.getByRole("button", { name: "Close" })).toBeVisible();
  await expect(page.getByLabel(/^E-mail/)).toHaveAttribute("aria-invalid", "true");
  // (Next's route announcer is a second, empty role="alert")
  await expect(page.getByRole("alert").filter({ hasText: "Payment failed" })).toBeVisible();
  expect(await loadedFonts(page)).toEqual(expect.arrayContaining(["inter", "fraunces"]));
  expect(offOrigin(requests, "http://localhost:3001/")).toEqual([]);
  expect(violations).toEqual([]);
});

test("platform /account: renders signed out with @igs/ui, no CSP violations (T-016)", async ({
  page,
}) => {
  const violations = await watchCsp(page);
  const requests = watchRequests(page);
  const res = await page.goto("http://localhost:3001/account", { waitUntil: "networkidle" });

  expect(res?.status()).toBe(200);
  await expect(page.locator("h1")).toHaveText("Your account");
  await expect(page.locator("h1")).toHaveCSS("color", await primaryColor(page));
  await expect(page.getByText("You are not signed in")).toBeVisible();
  expect(offOrigin(requests, "http://localhost:3001/")).toEqual([]);
  expect(violations).toEqual([]);
});
