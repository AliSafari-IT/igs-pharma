import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * igs-pharma#46 (IGS-D4): the storefront's site gate against the PRODUCTION build. :3002 runs with
 * SITE_GATE unset, so it must be closed by default; :3000 runs with SITE_GATE=off (the open site).
 */
const GATED = "http://localhost:3002";
const OPEN = "http://localhost:3000";

test("closed by default in production: every page is the coming-soon page, noindex, axe clean", async ({
  page,
}) => {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (m.text().includes("Content Security Policy")) violations.push(m.text());
  });

  // /nl/x.html: dotted paths go through the proxy too (the matcher does not skip them)
  for (const path of ["/", "/nl", "/fr/producten/paracetamol", "/en/account", "/nl/x.html"]) {
    const response = await page.goto(`${GATED}${path}`, { waitUntil: "networkidle" });
    expect(response?.status(), path).toBe(200);
    expect(page.url(), path).toBe(`${GATED}${path}`); // shown in place, no redirect
    expect(response?.headers()["x-robots-tag"], path).toBe("noindex, nofollow");
    await expect(page.getByRole("heading", { level: 1, name: "IGS-Pharma" })).toBeVisible();
  }
  // all four languages, each marked with its own lang
  for (const [lang, title] of [
    ["nl", "Binnenkort open"],
    ["fr", "Bientôt ouvert"],
    ["de", "Bald geöffnet"],
    ["en", "Opening soon"],
  ]) {
    await expect(
      page.locator(`section[lang="${lang}"]`).getByRole("heading", { name: title }),
    ).toBeVisible();
  }
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  // design tokens and the self-hosted display font are applied
  const h1 = page.getByRole("heading", { level: 1 });
  expect(await h1.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(15, 118, 110)");
  expect(violations).toEqual([]);

  const { violations: axe } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  const blocking = axe.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});

test("closed: health, the OS manifest and robots.txt stay reachable", async ({ request }) => {
  const live = await request.get(`${GATED}/api/health/live`);
  expect(live.status()).toBe(200);
  expect(await live.json()).toEqual({ status: "ok" });

  const manifest = await request.get(`${GATED}/.well-known/asafarim-app.json`);
  expect(manifest.status()).toBe(200);
  expect((await manifest.json()).id).toBeTruthy();

  const robots = await request.get(`${GATED}/robots.txt`);
  expect(await robots.text()).toMatch(/Disallow: \//);
});

test("SITE_GATE=off: the storefront is served, indexable", async ({ page, request }) => {
  const response = await page.goto(`${OPEN}/nl`);
  expect(response?.headers()["x-robots-tag"]).toBeUndefined();
  await expect(page.getByRole("heading", { level: 1, name: "IGS-Pharma" })).toBeVisible();
  await expect(page.getByText("Binnenkort open")).toHaveCount(0);
  expect(await (await request.get(`${OPEN}/robots.txt`)).text()).toMatch(/Allow: \//);
});
