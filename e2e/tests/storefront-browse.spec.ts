import { randomInt, randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";
import postgres from "postgres";

import { smokeDatabaseUrl } from "../smoke-env";

/**
 * igs-pharma#104, PR 1: the storefront shell against the production build of the OPEN storefront
 * (port 3000, SITE_GATE=off): home → category → product, pagination, the language switch keeping
 * the page, the localized 404 inside the shell, the legal placeholder pages, the identity footer
 * with its placeholder marker (and no EU logo while its flag is off), a 360 px phone, and layout
 * shift. The database parts need SMOKE_DATABASE_URL (a migrated database).
 */
const WEB = "http://localhost:3000";
const PAGE_SIZE = 24;
const EXTRA = 2; // products beyond one page

let sql: postgres.Sql | undefined;
const suffix = randomUUID().slice(0, 8);
const parent = { slug: `e2e-browse-${suffix}`, nl: `Huid ${suffix}`, fr: `Peau ${suffix}` };
const child = { slug: `e2e-browse-kid-${suffix}`, nl: `Zon ${suffix}`, fr: `Soleil ${suffix}` };
const cnkBase = randomInt(0, 90_000);
const productCnk = (n: number) => `95${String(cnkBase + n).padStart(5, "0")}`;
const productName = (n: number) => `Demo Browse ${String(n).padStart(2, "0")} ${suffix}`;
const productIds: string[] = [];

async function expectAxeClean(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

test.beforeAll(async () => {
  if (!smokeDatabaseUrl) return;
  sql = postgres(smokeDatabaseUrl, { max: 1, ssl: "require", onnotice: () => {} });
  const [top] = await sql<{ id: string }[]>`
    INSERT INTO catalog.categories (id, slug, name_nl, name_fr)
    VALUES (gen_random_uuid(), ${parent.slug}, ${parent.nl}, ${parent.fr}) RETURNING id`;
  const topId = (top as { id: string }).id;
  const [kid] = await sql<{ id: string }[]>`
    INSERT INTO catalog.categories (id, slug, name_nl, name_fr, parent_id)
    VALUES (gen_random_uuid(), ${child.slug}, ${child.nl}, ${child.fr}, ${topId}) RETURNING id`;
  const kidId = (kid as { id: string }).id;
  for (let n = 1; n <= PAGE_SIZE + EXTRA; n++) {
    const [product] = await sql<{ id: string }[]>`
      INSERT INTO catalog.products (id, cnk, product_type, legal_status, vat_class, status)
      VALUES (gen_random_uuid(), ${productCnk(n)}, 'cosmetic', 'general_sale', 'BE_21', 'active')
      RETURNING id`;
    const id = (product as { id: string }).id;
    productIds.push(id);
    await sql`
      INSERT INTO catalog.product_content (product_id, locale, name, short_description, source)
      VALUES
        (${id}, 'nl', ${productName(n)}, ${`Korte tekst ${n}`}, 'manual'),
        (${id}, 'fr', ${`${productName(n)} (FR)`}, ${`Texte court ${n}`}, 'manual')`;
    // the last one sits in the child category only: it shows in the parent through the subtree
    await sql`
      INSERT INTO catalog.product_categories (product_id, category_id)
      VALUES (${id}, ${n === PAGE_SIZE + EXTRA ? kidId : topId})`;
    // a product without a current price is not on the storefront (#103)
    await sql`
      INSERT INTO pricing.prices (id, product_id, channel, amount_cents, valid_from, created_by_type, created_by)
      VALUES (gen_random_uuid(), ${id}, 'web', ${500 + n}, now() - interval '1 hour', 'system', 'e2e')`;
  }
});

test.afterAll(async () => {
  if (sql) {
    for (const id of productIds) await sql`DELETE FROM catalog.products WHERE id = ${id}`;
    await sql`DELETE FROM catalog.categories WHERE slug IN (${child.slug}, ${parent.slug})`;
    await sql.end({ timeout: 5 });
  }
});

test("home: the shell, the category grid, the products, the identity footer", async ({ page }) => {
  test.skip(!sql, "set SMOKE_DATABASE_URL to a migrated database to run");
  await page.goto(`${WEB}/nl`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1, name: "IGS-Pharma" })).toBeVisible();
  await expect(page.getByText("Online bestellen kan binnenkort.")).toBeVisible();
  // the categories and products stream in behind a placeholder (#104); it is gone once they are shown
  await expect(page.locator('section[aria-labelledby="home-products"]')).toBeVisible();
  await expect(page.getByTestId("home-skeleton")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { level: 2, name: "Producten per categorie" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(parent.nl) }).first()).toBeVisible();
  // each tile has a decorative icon (#112); a category without its own icon gets the generic one
  const tileIcon = page
    .locator('section[aria-labelledby="home-categories"]')
    .getByRole("link", { name: new RegExp(parent.nl) })
    .getByTestId("category-icon");
  await expect(tileIcon).toHaveAttribute("data-icon", "generic");
  await expect(tileIcon).toHaveAttribute("aria-hidden", "true");
  // "Find your pharmacy" (#112): the same identity config as the footer, stand-ins marked as such
  const panel = page.getByTestId("pharmacy-panel");
  await expect(panel.getByRole("heading", { level: 2, name: "Vind uw apotheek" })).toBeVisible();
  await expect(panel).toContainText("[opening hours]");
  await expect(panel.getByTestId("pharmacy-panel-placeholder")).toHaveText(/nog te vervangen/);
  // outside opening hours (milestone 5.2): the national on-duty line and 112, both callable
  const onDuty = panel.getByTestId("pharmacy-on-duty");
  await expect(onDuty.getByRole("link", { name: "0903 99 000" })).toHaveAttribute(
    "href",
    "tel:090399000",
  );
  await expect(onDuty.getByRole("link", { name: "112" })).toHaveAttribute("href", "tel:112");
  // "How it works" promises ordering: it waits for the cart, which the smoke build keeps off
  await expect(page.getByTestId("how-it-works")).toHaveCount(0);
  await expect(panel.getByRole("link", { name: "Alle gegevens van de apotheek" })).toHaveAttribute(
    "href",
    "#footer-about",
  );
  // the header links to the same pharmacy details on every page (#112)
  await expect(page.getByTestId("header-pharmacy-link")).toHaveText("Onze apotheek");
  await expect(page.getByTestId("header-pharmacy-link")).toHaveAttribute("href", "#footer-about");
  const footer = page.getByTestId("site-footer");
  // the identity comes from one config with stand-ins, and says so
  await expect(footer.getByTestId("identity-placeholder")).toHaveText(/nog te vervangen/);
  await expect(footer.getByTestId("identity")).toContainText("[authorisation number]");
  // the VAT number (milestone 5.1, C11), a marked stand-in until the real one arrives
  await expect(footer.getByTestId("identity-vat")).toHaveText("[VAT number]");
  // the EU logo is behind a flag that is off
  await expect(page.getByTestId("eu-logo")).toHaveCount(0);
  await expectAxeClean(page);
});

test("home → category → product, with breadcrumbs and a visible, disabled order button", async ({
  page,
}) => {
  test.skip(!sql, "set SMOKE_DATABASE_URL to a migrated database to run");
  await page.goto(`${WEB}/nl`, { waitUntil: "networkidle" });
  await page
    .getByRole("link", { name: new RegExp(`^${parent.nl}`) })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`/nl/c/${parent.slug}$`));
  await expect(page.getByRole("heading", { level: 1, name: parent.nl })).toBeVisible();
  const crumbs = page.getByRole("navigation", { name: "Kruimelpad" });
  await expect(crumbs.getByRole("link", { name: "Startpagina" })).toBeVisible();
  await expect(crumbs.getByText(parent.nl)).toHaveAttribute("aria-current", "page");
  // each card has a decorative image area (#112): its top-level category's art (generic for e2e slugs)
  const cardArt = page.getByRole("article").first().getByTestId("product-illustration");
  await expect(cardArt).toHaveAttribute("data-icon", "generic");
  await expect(cardArt).toHaveAttribute("aria-hidden", "true");
  await expectAxeClean(page);

  // the child category: the trail has two levels
  await page
    .getByRole("navigation", { name: "Categorieën" })
    .getByRole("link", { name: child.nl })
    .click();
  await expect(crumbs.getByRole("link", { name: parent.nl })).toBeVisible();
  await expect(crumbs.getByText(child.nl)).toHaveAttribute("aria-current", "page");
  // the card shows its top-level category's illustration (#112): the parent's, a slug without its
  // own icon, so the generic one; decorative only
  const card = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("link", { name: productName(PAGE_SIZE + EXTRA) }) });
  const childCardArt = card.getByTestId("product-illustration");
  await expect(childCardArt).toHaveAttribute("data-icon", "generic");
  await expect(childCardArt).toHaveAttribute("aria-hidden", "true");
  await page.getByRole("link", { name: productName(PAGE_SIZE + EXTRA) }).click();
  await expect(page).toHaveURL(new RegExp(`/nl/p/${productCnk(PAGE_SIZE + EXTRA)}$`));
  await expect(page.getByRole("button", { name: "In winkelwagen" })).toBeDisabled();
  // no pickup price while ordering is off (milestone 5.2: it shows with the cart)
  await expect(page.getByTestId("pickup-cost")).toHaveCount(0);
  // the product page's image area takes the ROOT category's art; an e2e slug has none of its own
  const productArt = page.getByTestId("product-illustration");
  await expect(productArt).toHaveCount(1);
  await expect(productArt).toHaveAttribute("data-icon", "generic");
  await expect(productArt).toHaveAttribute("aria-hidden", "true");
});

test("a category with more than a page paginates, and the language switch keeps the page", async ({
  page,
}) => {
  test.skip(!sql, "set SMOKE_DATABASE_URL to a migrated database to run");
  await page.goto(`${WEB}/nl/c/${parent.slug}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("article")).toHaveCount(PAGE_SIZE);
  await expect(page.getByText(`${PAGE_SIZE + EXTRA} producten`)).toBeVisible();
  // the listing streams in behind a placeholder (#104, §10.8); once it is there the placeholder is gone
  await expect(page.getByTestId("listing-skeleton")).toHaveCount(0);
  const pages = page.getByRole("navigation", { name: "Pagina's" });
  await expect(pages.getByText("1", { exact: true })).toHaveAttribute("aria-current", "page");
  await expectAxeClean(page);

  await pages.getByRole("link", { name: "Volgende pagina" }).click();
  await expect(page).toHaveURL(new RegExp(`/nl/c/${parent.slug}\\?page=2$`));
  await expect(page.getByRole("article")).toHaveCount(EXTRA);

  // Français: the same category, the same page, the French names
  // the language menu (#193): a native disclosure in the top bar
  await page.getByTestId("language-menu").locator("summary").click();
  await page
    .getByRole("navigation", { name: "Taal" })
    .getByRole("link", { name: "Français" })
    .click();
  await expect(page).toHaveURL(new RegExp(`/fr/c/${parent.slug}\\?page=2$`));
  await expect(page.getByRole("heading", { level: 1, name: parent.fr })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page.getByRole("navigation", { name: "Fil d'Ariane" })).toBeVisible();
});

test("light and dark: the toggle switches at once and the server remembers it (#191)", async ({
  page,
  context,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  test.skip(!sql, "set SMOKE_DATABASE_URL to a migrated database to run");
  await page.goto(`${WEB}/nl`, { waitUntil: "networkidle" });
  const html = page.locator("html");
  await expect(html).not.toHaveAttribute("data-theme", /./);
  const toggle = page.getByTestId("theme-toggle");
  await expect(toggle).toHaveAttribute("aria-label", "Donker thema gebruiken");
  await toggle.click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  const cookie = (await context.cookies()).find((c) => c.name === "igs_theme");
  expect(cookie?.value).toBe("dark");
  // the next page comes from the server already dark, and is still accessible
  await page.reload({ waitUntil: "networkidle" });
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(toggle).toHaveAttribute("aria-label", "Licht thema gebruiken");
  await expectAxeClean(page);
  await toggle.click();
  await expect(html).toHaveAttribute("data-theme", "light");
});

test("an unknown page is a localized 404 inside the shell", async ({ page }) => {
  for (const [locale, title, home] of [
    ["nl", "Pagina niet gevonden", "Terug naar de startpagina"],
    ["fr", "Page introuvable", "Retour à l'accueil"],
    ["de", "Seite nicht gefunden", "Zur Startseite"],
    ["en", "Page not found", "Back to the home page"],
  ] as const) {
    const response = await page.goto(`${WEB}/${locale}/c/no-such-category-${suffix}`);
    expect(response?.status(), locale).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: title }), locale).toBeVisible();
    await expect(page.getByRole("link", { name: home }), locale).toBeVisible();
    await expect(page.getByTestId("site-footer"), locale).toBeVisible();
  }
  await page.goto(`${WEB}/nl/p/0000000`);
  await expectAxeClean(page);
});

test("terms, privacy and cookies are placeholder pages in every language", async ({ page }) => {
  const titles = {
    nl: ["Algemene voorwaarden", "Privacy", "Cookies"],
    fr: ["Conditions générales", "Confidentialité", "Cookies"],
    de: ["Allgemeine Geschäftsbedingungen", "Datenschutz", "Cookies"],
    en: ["Terms and conditions", "Privacy", "Cookies"],
  } as const;
  for (const [locale, names] of Object.entries(titles)) {
    for (const [index, doc] of (["terms", "privacy", "cookies"] as const).entries()) {
      const response = await page.goto(`${WEB}/${locale}/legal/${doc}`, {
        waitUntil: "networkidle",
      });
      expect(response?.status(), `${locale}/${doc}`).toBe(200);
      await expect(
        page.getByRole("heading", { level: 1, name: names[index] as string }),
        `${locale}/${doc}`,
      ).toBeVisible();
      await expect(page.getByTestId("legal-pending"), `${locale}/${doc}`).toBeVisible();
    }
  }
  expect((await page.goto(`${WEB}/nl/legal/nope`))?.status()).toBe(404);
  await page.goto(`${WEB}/nl/legal/terms`, { waitUntil: "networkidle" });
  await expectAxeClean(page);
  // the footer links lead there
  await page.getByTestId("site-footer").getByRole("link", { name: "Cookies" }).click();
  await expect(page).toHaveURL(/\/nl\/legal\/cookies$/);
});

test.describe("a phone, 360 px wide", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test("no sideways scrolling, the categories are a disclosure, the touch targets are big", async ({
    page,
  }) => {
    test.skip(!sql, "set SMOKE_DATABASE_URL to a migrated database to run");
    for (const path of [
      "/nl",
      `/nl/c/${parent.slug}`,
      `/nl/p/${productCnk(1)}`,
      "/nl/legal/terms",
    ]) {
      await page.goto(`${WEB}${path}`, { waitUntil: "networkidle" });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
      await expectAxeClean(page);
    }
    await page.goto(`${WEB}/nl`, { waitUntil: "networkidle" });
    // the categories are chips in a row that scrolls sideways (#193), each a 44 px target
    const link = page
      .getByRole("navigation", { name: "Categorieën" })
      .getByRole("link", { name: parent.nl });
    await expect(link).toBeVisible();
    const box = await link.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    // the tab bar (#193): Shop and Search (Cart and Account join when those features are on)
    const tabs = page.getByRole("navigation", { name: "Snelmenu" });
    await expect(tabs.getByRole("link", { name: "Winkel" })).toBeVisible();
    await tabs.getByRole("link", { name: "Zoeken" }).click();
    await expect(page).toHaveURL(/\/nl\/search$/);
  });
});

test("layout shift on the home and a category stays small (CLS)", async ({ page }) => {
  test.skip(!sql, "set SMOKE_DATABASE_URL to a migrated database to run");
  for (const path of ["/nl", `/nl/c/${parent.slug}`]) {
    await page.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as {
          value: number;
          hadRecentInput: boolean;
        }[]) {
          if (!entry.hadRecentInput) (window as unknown as { __cls: number }).__cls += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto(`${WEB}${path}`, { waitUntil: "networkidle" });
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    console.info(`CLS ${path}: ${cls.toFixed(4)}`);
    expect(cls, path).toBeLessThan(0.1);
  }
});
