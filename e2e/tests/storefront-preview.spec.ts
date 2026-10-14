import { randomInt, randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";
import postgres from "postgres";

import { smokeDatabaseUrl, smokePreviewKey } from "../smoke-env";

/**
 * igs-pharma#62: the storefront preview against the production build. The gated server (port 3002,
 * SITE_GATE unset) shows "coming soon" to everyone, except a visitor who holds the preview key: the
 * list and the product page then render, read-only, with a banner. The database parts need
 * SMOKE_DATABASE_URL (a migrated database).
 */
const GATED = "http://localhost:3002";
/** igs-pharma#91: the key is typed into the form at /preview and POSTed, never put in a URL. */
async function openPreview(page: Page, key = smokePreviewKey) {
  await page.goto(`${GATED}/preview`);
  await page.getByLabel("Preview key").fill(key);
  await Promise.all([
    page.waitForLoadState("networkidle"),
    page.getByRole("button", { name: "Open the preview" }).click(),
  ]);
}

let sql: postgres.Sql | undefined;
const suffix = randomUUID().slice(0, 8);
const categorySlug = `e2e-preview-${suffix}`;
const cnk = () => `93${String(randomInt(0, 100_000)).padStart(5, "0")}`;
const stocked = { cnk: cnk(), name: `Demo Voorraad ${suffix}` };
const soldOut = { cnk: cnk(), name: `Demo Uitverkocht ${suffix}` };
const draft = { cnk: cnk(), name: `Demo Concept ${suffix}` };
// D-034: ACTIVE, priced and in a category, yet never shown (by legal status / by product type)
const rxLegal = { cnk: cnk(), name: `Demo Rx Wettelijk ${suffix}` };
const rxType = { cnk: cnk(), name: `Demo Rx Type ${suffix}` };
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
  // the same TLS the production build insists on (see smoke-env.ts)
  sql = postgres(smokeDatabaseUrl, { max: 1, ssl: "require", onnotice: () => {} });
  const [category] = await sql<{ id: string }[]>`
    INSERT INTO catalog.categories (id, slug, name_nl, name_fr)
    VALUES (gen_random_uuid(), ${categorySlug}, ${`Pijn ${suffix}`}, ${`Douleur ${suffix}`})
    RETURNING id`;
  const [location] = await sql<{ id: string }[]>`SELECT id FROM inventory.locations LIMIT 1`;
  for (const [item, status, type, legal] of [
    [stocked, "active", "otc_medicine", "otc"],
    [soldOut, "active", "otc_medicine", "otc"],
    [draft, "draft", "otc_medicine", "otc"],
    [rxLegal, "active", "otc_medicine", "rx"],
    [rxType, "active", "rx_medicine", "otc"],
  ] as const) {
    const [product] = await sql<{ id: string }[]>`
      INSERT INTO catalog.products (id, cnk, product_type, legal_status, vat_class, status)
      VALUES (gen_random_uuid(), ${item.cnk}, ${type}, ${legal}, 'BE_6', ${status})
      RETURNING id`;
    const id = (product as { id: string }).id;
    productIds.push(id);
    await sql`
      INSERT INTO catalog.product_content (product_id, locale, name, description, warnings, source)
      VALUES
        (${id}, 'nl', ${item.name}, ${`Beschrijving van ${item.name}`}, ${`Let op: ${item.name}`}, 'manual'),
        (${id}, 'fr', ${`${item.name} (FR)`}, ${`Description de ${item.name}`}, NULL, 'manual')`;
    await sql`
      INSERT INTO catalog.product_categories (product_id, category_id)
      VALUES (${id}, ${(category as { id: string }).id})`;
    await sql`
      INSERT INTO pricing.prices (id, product_id, channel, amount_cents, valid_from, created_by_type, created_by)
      VALUES (gen_random_uuid(), ${id}, 'web', 599, now() - interval '1 hour', 'system', 'e2e')`;
  }
  await sql`
    INSERT INTO inventory.stock_movements (id, product_id, location_id, delta, reason, actor_type, actor_id)
    VALUES (gen_random_uuid(), ${productIds[0] as string}, ${(location as { id: string }).id}, 12, 'adjustment', 'system', 'e2e')`;
});

test.afterAll(async () => {
  // prices and stock movements are append-only and stay; they reference no table
  if (sql) {
    for (const id of productIds) await sql`DELETE FROM catalog.products WHERE id = ${id}`;
    await sql`DELETE FROM catalog.categories WHERE slug = ${categorySlug}`;
    await sql.end({ timeout: 5 });
  }
});

test.describe.configure({ mode: "serial" });

test("without the cookie every storefront page is coming-soon, and robots disallows everything", async ({
  page,
  request,
}) => {
  for (const path of ["/nl", `/nl/c/${categorySlug}`, `/fr/p/${stocked.cnk}`, "/en"]) {
    const response = await page.goto(`${GATED}${path}`);
    expect(response?.headers()["x-robots-tag"], path).toBe("noindex, nofollow");
    await expect(page.getByText("Binnenkort open"), path).toBeVisible();
    await expect(page.getByText(stocked.name), path).toHaveCount(0);
    await expect(page.getByText("Preview — not public"), path).toHaveCount(0);
  }
  expect(await (await request.get(`${GATED}/robots.txt`)).text()).toMatch(/Disallow: \//);
});

test("a key in the URL or a wrong key gets coming-soon and no cookie", async ({
  page,
  context,
}) => {
  for (const path of [`/preview?key=${smokePreviewKey}`, "/preview?key=", "/preview?key=x"]) {
    const response = await page.goto(`${GATED}${path}`);
    expect(response?.status(), path).toBe(200);
    await expect(page.getByText("Binnenkort open"), path).toBeVisible();
    expect(await context.cookies(), path).toEqual([]);
  }
  await page.goto(`${GATED}/preview`);
  await expectAxeClean(page);
  await openPreview(page, "not-the-key");
  await expect(page.getByText("Binnenkort open")).toBeVisible();
  expect(await context.cookies()).toEqual([]);
});

test("with the key: banner, a category, a product with price, VAT and availability", async ({
  page,
  context,
}) => {
  test.skip(!sql, "set SMOKE_DATABASE_URL to a migrated database to run");
  await openPreview(page);
  expect(new URL(page.url()).pathname).toBe("/nl");
  const response = await page.reload({ waitUntil: "networkidle" });
  expect(response?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  expect(response?.headers()["cache-control"]).toBe("no-store");

  const cookie = (await context.cookies()).find((c) => c.name === "igs_preview");
  expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
  expect(cookie?.value).not.toContain(smokePreviewKey);

  await expect(page.getByText("Preview — not public")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "IGS-Pharma" })).toBeVisible();
  await expectAxeClean(page);

  // the category tree is the navigation
  await page
    .getByRole("navigation", { name: "Categorieën" })
    .getByRole("link", { name: `Pijn ${suffix}` })
    .click();
  await expect(page).toHaveURL(new RegExp(`/nl/c/${categorySlug}$`));
  await expect(page.getByRole("heading", { level: 1, name: `Pijn ${suffix}` })).toBeVisible();
  const stockedCard = page.getByRole("article").filter({ hasText: stocked.name });
  await expect(stockedCard.getByText("Op voorraad")).toBeVisible();
  await expect(stockedCard.getByText(/5,99/)).toBeVisible();
  await expect(stockedCard.getByText(/incl\. 6\s?% btw/)).toBeVisible();
  await expect(
    page.getByRole("article").filter({ hasText: soldOut.name }).getByText("Niet op voorraad"),
  ).toBeVisible();
  // a draft does not exist, and no stock count is ever shown
  await expect(page.getByText(draft.name)).toHaveCount(0);
  // a prescription medicine does not exist either, though it is active, priced and categorised
  await expect(page.getByText(rxLegal.name)).toHaveCount(0);
  await expect(page.getByText(rxType.name)).toHaveCount(0);
  await expect(page.getByText(/\b12\b/)).toHaveCount(0);
  await expectAxeClean(page);

  await page.getByRole("link", { name: stocked.name }).click();
  await expect(page).toHaveURL(new RegExp(`/nl/p/${stocked.cnk}$`));
  await expect(page.getByRole("heading", { level: 1, name: stocked.name })).toBeVisible();
  await expect(page.getByText(`Beschrijving van ${stocked.name}`)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Waarschuwingen" })).toBeVisible();
  await expect(page.getByText(`Let op: ${stocked.name}`)).toBeVisible();
  await expect(page.getByText("Op voorraad")).toBeVisible();
  await expect(page.getByText(/5,99/)).toBeVisible();
  await expect(page.getByRole("button", { name: "In winkelwagen" })).toBeDisabled();
  await expectAxeClean(page);

  // French: the French texts; no French warnings, so none are borrowed from Dutch
  await page.goto(`${GATED}/fr/p/${stocked.cnk}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1, name: `${stocked.name} (FR)` })).toBeVisible();
  await expect(page.getByText("En stock")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mises en garde" })).toHaveCount(0);
  // German has no content here: the Dutch texts, flagged as such
  await page.goto(`${GATED}/de/p/${stocked.cnk}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1, name: stocked.name })).toBeVisible();
  await expect(page.getByText("noch nicht in Ihrer Sprache")).toBeVisible();

  // a draft, a prescription medicine and an unknown CNK are the same plain 404, even with the cookie
  for (const missing of [draft.cnk, rxLegal.cnk, rxType.cnk, "0000000"]) {
    const gone = await page.goto(`${GATED}/nl/p/${missing}`);
    expect(gone?.status(), missing).toBe(404);
    await expect(page.getByText("Pagina niet gevonden"), missing).toBeVisible();
  }

  // robots.txt still disallows everything while the preview is on
  expect(await (await page.request.get(`${GATED}/robots.txt`)).text()).toMatch(/Disallow: \//);
});

test("a private window without the cookie still sees coming-soon; ending the preview closes it", async ({
  browser,
  page,
}) => {
  test.skip(!sql, "set SMOKE_DATABASE_URL to a migrated database to run");
  const privateWindow = await browser.newContext();
  const stranger = await privateWindow.newPage();
  await stranger.goto(`${GATED}/nl/c/${categorySlug}`);
  await expect(stranger.getByText("Binnenkort open")).toBeVisible();
  await privateWindow.close();

  await openPreview(page);
  await expect(page.getByText("Preview — not public")).toBeVisible();
  await page.getByRole("link", { name: "End preview" }).click();
  await expect(page.getByText("Binnenkort open")).toBeVisible();
  await page.goto(`${GATED}/nl`);
  await expect(page.getByText("Binnenkort open")).toBeVisible();
});
