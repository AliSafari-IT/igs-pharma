import { randomInt, randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";
import postgres from "postgres";

import { smokeDatabaseUrl } from "../smoke-env";

/**
 * igs-pharma#104, PR 2: product search and the product page against the production build of the
 * OPEN storefront (port 3000, SITE_GATE=off): the header search, an exact CNK going straight to the
 * product, the too-short and no-result states, sort and the in-stock filter, the three availability
 * states, the medicine notice, an untranslated text, and a 360 px phone. The database parts need
 * SMOKE_DATABASE_URL (a migrated database).
 */
const WEB = "http://localhost:3000";

let sql: postgres.Sql | undefined;
const suffix = randomUUID().slice(0, 8);
const word = `Zoekzalf${suffix}`;
const cnkBase = randomInt(0, 90_000);
const cnk = (n: number) => `96${String(cnkBase + n).padStart(5, "0")}`;
const productIds: string[] = [];

interface Seed {
  readonly n: number;
  readonly name: string;
  readonly cents: number;
  /** Units on the shelf: 0 out, 1..3 low, more available. */
  readonly stock: number;
  readonly type: "cosmetic" | "otc_medicine";
  /** No French text: the French page falls back to Dutch. */
  readonly dutchOnly?: boolean;
}
const SEEDS: readonly Seed[] = [
  { n: 1, name: `${word} Goedkoop`, cents: 450, stock: 12, type: "cosmetic" },
  { n: 2, name: `${word} Duur`, cents: 1999, stock: 2, type: "cosmetic" },
  { n: 3, name: `${word} Uitverkocht`, cents: 900, stock: 0, type: "cosmetic" },
  { n: 4, name: `${word} Geneesmiddel`, cents: 750, stock: 5, type: "otc_medicine" },
  { n: 5, name: `${word} Nederlands`, cents: 600, stock: 5, type: "cosmetic", dutchOnly: true },
];
const seed = (n: number) => SEEDS.find((s) => s.n === n) as Seed;

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
  const [location] = await sql<{ id: string }[]>`SELECT id FROM inventory.locations LIMIT 1`;
  const [category] = await sql<{ id: string }[]>`
    INSERT INTO catalog.categories (id, slug, name_nl, name_fr)
    VALUES (gen_random_uuid(), ${`e2e-search-${suffix}`}, ${`Zalven ${suffix}`}, ${`Pommades ${suffix}`})
    RETURNING id`;
  for (const item of SEEDS) {
    const medicine = item.type === "otc_medicine";
    const [product] = await sql<{ id: string }[]>`
      INSERT INTO catalog.products (id, cnk, product_type, legal_status, vat_class, status)
      VALUES (gen_random_uuid(), ${cnk(item.n)}, ${item.type}, ${medicine ? "otc" : "general_sale"}, 'BE_6', 'active')
      RETURNING id`;
    const id = (product as { id: string }).id;
    productIds.push(id);
    await sql`
      INSERT INTO catalog.product_content (product_id, locale, name, description, source, approved_by, approved_at)
      VALUES (${id}, 'nl', ${item.name}, ${`Beschrijving van ${item.name}`}, 'manual', gen_random_uuid(), now())`;
    if (!item.dutchOnly) {
      await sql`
        INSERT INTO catalog.product_content (product_id, locale, name, description, source, approved_by, approved_at)
        VALUES (${id}, 'fr', ${`${item.name} (FR)`}, ${`Description de ${item.name}`}, 'manual', gen_random_uuid(), now())`;
    }
    await sql`
      INSERT INTO catalog.product_categories (product_id, category_id)
      VALUES (${id}, ${(category as { id: string }).id})`;
    await sql`
      INSERT INTO pricing.prices (id, product_id, channel, amount_cents, valid_from, created_by_type, created_by)
      VALUES (gen_random_uuid(), ${id}, 'web', ${item.cents}, now() - interval '1 hour', 'system', 'e2e')`;
    if (item.stock > 0) {
      await sql`
        WITH lot AS (
          INSERT INTO inventory.lots (id, product_id, location_id, tracking, lot_number, expiry_date, created_by_type, created_by_id)
          VALUES (gen_random_uuid(), ${id}, ${(location as { id: string }).id}::uuid,
            ${medicine ? "lot" : "no_lot"}, ${medicine ? "E2E-1" : null}, ${medicine ? "2099-12-31" : null}::date,
            'system', 'e2e')
          RETURNING id
        )
        INSERT INTO inventory.stock_movements (id, product_id, location_id, lot_id, delta, reason, actor_type, actor_id)
        VALUES (gen_random_uuid(), ${id}, ${(location as { id: string }).id}::uuid, (SELECT id FROM lot),
          ${item.stock}, 'adjustment', 'system', 'e2e')`;
    }
  }
});

test.afterAll(async () => {
  // prices and stock movements are append-only and stay
  if (sql) {
    for (const id of productIds) await sql`DELETE FROM catalog.products WHERE id = ${id}`;
    await sql`DELETE FROM catalog.categories WHERE slug = ${`e2e-search-${suffix}`}`;
    await sql.end({ timeout: 5 });
  }
});

test("the header search finds products by name, and the form works from every page", async ({
  page,
}) => {
  test.skip(!sql, "set SMOKE_DATABASE_URL to a migrated database to run");
  await page.goto(`${WEB}/nl`, { waitUntil: "networkidle" });
  const search = page.getByRole("search");
  await search.getByRole("searchbox", { name: "Zoek een product" }).fill(word);
  await search.getByRole("button", { name: "Zoeken" }).click();
  await expect(page).toHaveURL(new RegExp(`/nl/search\\?q=${word}$`));
  await expect(
    page.getByRole("heading", { level: 1, name: `Zoekresultaten voor “${word}”` }),
  ).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(SEEDS.length);
  await expect(page.getByText(`${SEEDS.length} producten`)).toBeVisible();
  // the results stream in behind a placeholder (#104, §10.8); once they are there it is gone
  await expect(page.getByTestId("listing-skeleton")).toHaveCount(0);
  // the field keeps what was typed
  await expect(page.getByRole("searchbox")).toHaveValue(word);
  await expectAxeClean(page);
});

test("sort by price and the in-stock filter, kept in the URL and in the language links", async ({
  page,
}) => {
  test.skip(!sql, "set SMOKE_DATABASE_URL to a migrated database to run");
  await page.goto(`${WEB}/nl/search?q=${word}`, { waitUntil: "networkidle" });
  await page.getByLabel("Sorteren op").selectOption("price_asc");
  await page.getByRole("button", { name: "Toepassen" }).click();
  await expect(page).toHaveURL(new RegExp(`q=${word}&sort=price_asc`));
  // the sorted results stream in (#104, §10.8): wait for them, never read the list once
  const names = page.getByRole("article").getByRole("heading");
  await expect(names).toHaveCount(SEEDS.length);
  await expect(names.first()).toHaveText(seed(1).name);
  await expect(names.last()).toHaveText(seed(2).name);

  await page.getByLabel("Alleen op voorraad").check();
  await page.getByRole("button", { name: "Toepassen" }).click();
  await expect(page).toHaveURL(/availability=in_stock/);
  await expect(page.getByText(seed(3).name)).toHaveCount(0);
  await expect(page.getByRole("article")).toHaveCount(SEEDS.length - 1);

  // the language switch keeps the query, the sort and the filter
  await page
    .getByRole("navigation", { name: "Taal" })
    .getByRole("link", { name: "Français" })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/fr/search\\?q=${word}&sort=price_asc&availability=in_stock`),
  );
  await expect(page.getByLabel("Trier par")).toHaveValue("price_asc");
  await expect(page.getByLabel("En stock uniquement")).toBeChecked();

  await page.getByRole("link", { name: "Effacer les filtres" }).click();
  await expect(page).toHaveURL(new RegExp(`/fr/search\\?q=${word}$`));
});

test("an exact CNK goes straight to the product; a short or unknown query says so", async ({
  page,
}) => {
  test.skip(!sql, "set SMOKE_DATABASE_URL to a migrated database to run");
  await page.goto(`${WEB}/nl/search?q=${cnk(1)}`, { waitUntil: "networkidle" });
  await expect(page).toHaveURL(new RegExp(`/nl/p/${cnk(1)}$`));
  await expect(page.getByRole("heading", { level: 1, name: seed(1).name })).toBeVisible();

  await page.goto(`${WEB}/nl/search?q=a`, { waitUntil: "networkidle" });
  await expect(page.getByRole("alert").filter({ hasText: "minstens 2 tekens" })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
  await expectAxeClean(page);

  await page.goto(`${WEB}/nl/search?q=nietbestaand${suffix}`, { waitUntil: "networkidle" });
  await expect(
    page.getByText(`Geen producten gevonden voor “nietbestaand${suffix}”.`),
  ).toBeVisible();
  // the way out: the categories
  await expect(
    page.getByRole("heading", { level: 2, name: "Producten per categorie" }),
  ).toBeVisible();
  await expectAxeClean(page);

  // an unknown CNK is a plain empty result, not an error
  const response = await page.goto(`${WEB}/nl/search?q=0000000`);
  expect(response?.status()).toBe(200);
  await expect(page.getByText("Geen producten gevonden voor “0000000”.")).toBeVisible();
});

test("the product page shows each availability state, the breadcrumb and the medicine notice", async ({
  page,
}) => {
  test.skip(!sql, "set SMOKE_DATABASE_URL to a migrated database to run");
  const states = [
    [1, "Op voorraad"],
    [2, "Nog enkele beschikbaar"],
    [3, "Niet op voorraad"],
  ] as const;
  for (const [n, label] of states) {
    await page.goto(`${WEB}/nl/p/${cnk(n)}`, { waitUntil: "networkidle" });
    await expect(page.getByText(label, { exact: true }), label).toBeVisible();
    await expect(page.getByTestId("medicine-notice"), label).toHaveCount(0);
  }
  await page.goto(`${WEB}/nl/p/${cnk(2)}`, { waitUntil: "networkidle" });
  await expect(page.getByText(/19,99/)).toBeVisible();
  await expect(page.getByText(/incl\. 6\s?% btw/)).toBeVisible();
  const crumbs = page.getByRole("navigation", { name: "Kruimelpad" });
  await expect(crumbs.getByRole("link", { name: `Zalven ${suffix}` })).toBeVisible();
  await expect(crumbs.getByText(seed(2).name)).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: "In winkelwagen" })).toBeDisabled();
  await expect(page.getByText(/\b12\b/)).toHaveCount(0); // never a stock count
  await expectAxeClean(page);

  await page.goto(`${WEB}/nl/p/${cnk(4)}`, { waitUntil: "networkidle" });
  const notice = page.getByTestId("medicine-notice");
  await expect(notice).toContainText("bijsluiter");
  // the amber "ask your pharmacist" panel (#112) has its own heading
  await expect(
    notice.getByRole("heading", { level: 2, name: "Vraag het uw apotheker" }),
  ).toBeVisible();
  await expectAxeClean(page);
});

test("a product without the shopper's language shows the Dutch text with a notice", async ({
  page,
}) => {
  test.skip(!sql, "set SMOKE_DATABASE_URL to a migrated database to run");
  await page.goto(`${WEB}/fr/p/${cnk(5)}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1, name: seed(5).name })).toHaveAttribute(
    "lang",
    "nl",
  );
  await expect(
    page.getByText("Ce texte n'est pas encore disponible dans votre langue."),
  ).toBeVisible();
  await expectAxeClean(page);
});

test.describe("a phone, 360 px wide", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test("search, results and product fit the screen with 44 px targets", async ({ page }) => {
    test.skip(!sql, "set SMOKE_DATABASE_URL to a migrated database to run");
    for (const path of [`/nl/search?q=${word}`, `/nl/p/${cnk(4)}`, "/nl/search?q=a"]) {
      await page.goto(`${WEB}${path}`, { waitUntil: "networkidle" });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
      await expectAxeClean(page);
    }
    await page.goto(`${WEB}/nl/search?q=${word}`, { waitUntil: "networkidle" });
    for (const target of [
      page.getByRole("searchbox"),
      page.getByRole("search").getByRole("button"),
      page.getByLabel("Sorteren op"),
      page.locator("label[for=list-in-stock]"), // the whole label is the target
      page.getByRole("button", { name: "Toepassen" }),
    ]) {
      const box = await target.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44 - 1);
    }
  });
});
