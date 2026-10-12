import { createHmac, randomInt, randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { type BrowserContext, type Page, expect, test } from "@playwright/test";
import postgres from "postgres";

import { smokeDatabaseUrl, smokeEnv } from "../smoke-env";

/**
 * igs-pharma#54: back-office categories against the production build. A signed-in owner (who proved
 * a second factor) adds a category and a sub-category, reorders siblings with the keyboard-friendly
 * buttons, puts a product in the sub-category, and finds a category in use can't be deleted. Needs
 * SMOKE_DATABASE_URL (a migrated database).
 */
test.skip(!smokeDatabaseUrl, "set SMOKE_DATABASE_URL to a migrated database to run");

const PLATFORM = "http://localhost:3001";

let sql: postgres.Sql;
let userId: string;
let token: string;
let productId: string;
// a fake CNK no seed uses (the synthetic seed uses 0000001–0000020)
const cnk = `95${String(randomInt(0, 100_000)).padStart(5, "0")}`;
const run = randomUUID().slice(0, 8);
const nameNl = `Demo E2E categories ${run}`;
// every category this run makes has a slug starting with this, so afterAll can find them
const prefix = `e2e-${run}`;

/** Better Auth's signed session cookie: `<token>.<base64 HMAC-SHA256>`, URI-encoded (better-call). */
const signed = (value: string) =>
  encodeURIComponent(
    `${value}.${createHmac("sha256", smokeEnv.AUTH_SECRET).update(value).digest("base64")}`,
  );

async function signIn(context: BrowserContext) {
  await context.addCookies([
    { name: "better-auth.session_token", value: signed(token), url: PLATFORM },
  ]);
}

async function expectAxeClean(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

const tree = (page: Page) => page.getByRole("region", { name: "All categories" });

async function addCategory(
  page: Page,
  names: { nl: string; fr: string },
  slug: string,
  parent?: string,
) {
  await page.getByLabel("Name (Dutch)").fill(names.nl);
  await page.getByLabel("Name (French)").fill(names.fr);
  await page.getByLabel("Web address").fill(slug);
  if (parent) await page.getByLabel("Put it under").selectOption({ label: parent });
  await page.getByRole("button", { name: "Add category" }).click();
  // not the "Category added" alert: an earlier add left it on the page
  await expect(tree(page).getByRole("link", { name: names.nl, exact: true })).toBeVisible();
}

test.beforeAll(async () => {
  // the same TLS the production build insists on (see smoke-env.ts)
  sql = postgres(smokeDatabaseUrl as string, { max: 1, ssl: "require", onnotice: () => {} });
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO identity.users (id, name, email, email_verified, kind)
    VALUES (gen_random_uuid(), 'Category Owner', ${`${randomUUID()}@example.test`}, true, 'staff')
    RETURNING id`;
  userId = (user as { id: string }).id;
  await sql`
    INSERT INTO identity.user_roles (id, user_id, role_key, location_id)
    VALUES (gen_random_uuid(), ${userId}, 'owner', NULL)`;
  await sql`
    INSERT INTO identity.passkeys (id, user_id, public_key, credential_id, counter, device_type, backed_up)
    VALUES (gen_random_uuid(), ${userId}, 'pk', ${randomUUID()}, 0, 'singleDevice', false)`;
  token = randomUUID();
  await sql`
    INSERT INTO identity.sessions (id, user_id, token, expires_at, mfa_verified_at)
    VALUES (gen_random_uuid(), ${userId}, ${token}, now() + interval '1 hour', now())`;
  const [product] = await sql<{ id: string }[]>`
    INSERT INTO catalog.products (id, cnk, product_type, legal_status, vat_class)
    VALUES (gen_random_uuid(), ${cnk}, 'general', 'general_sale', 'BE_21')
    RETURNING id`;
  productId = (product as { id: string }).id;
  await sql`
    INSERT INTO catalog.product_content (product_id, locale, name, source)
    VALUES (${productId}, 'nl', ${nameNl}, 'manual')`;
});

test.afterAll(async () => {
  if (productId) await sql`DELETE FROM catalog.products WHERE id = ${productId}`;
  // children before parents (the tree's foreign key refuses the other order)
  for (let i = 0; i < 4; i++) {
    await sql`
      DELETE FROM catalog.categories c WHERE c.slug LIKE ${`${prefix}%`}
        AND NOT EXISTS (SELECT 1 FROM catalog.categories k WHERE k.parent_id = c.id)`;
  }
  if (userId) await sql`DELETE FROM identity.users WHERE id = ${userId}`;
  await sql?.end({ timeout: 5 });
});

test.describe.configure({ mode: "serial" });

const main = `Demo hoofd ${run}`;
const subA = `Demo sub A ${run}`;
const subB = `Demo sub B ${run}`;

test("signed out: the categories page sends you to sign in", async ({ page }) => {
  await page.goto(`${PLATFORM}/categories`);
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("owner: add a category and two sub-categories, then reorder them", async ({
  page,
  context,
}) => {
  await signIn(context);
  await page.goto(`${PLATFORM}/categories`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Categories", level: 1 })).toBeVisible();
  await expectAxeClean(page);

  // a bad web address keeps what was typed and says why
  await page.getByLabel("Name (Dutch)").fill(main);
  await page.getByLabel("Name (French)").fill(`Démo principale ${run}`);
  await page.getByLabel("Web address").fill("Not a slug");
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByText("Use lowercase letters, digits and single dashes")).toBeVisible();
  await expect(page.getByLabel("Name (Dutch)")).toHaveValue(main);
  await expectAxeClean(page);

  await page.getByLabel("Web address").fill(prefix);
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByText("Category added")).toBeVisible();
  await addCategory(page, { nl: subA, fr: `Démo sous A ${run}` }, `${prefix}-a`, main);
  await addCategory(page, { nl: subB, fr: `Démo sous B ${run}` }, `${prefix}-b`, main);

  const names = tree(page).getByRole("link", { name: new RegExp(`^Demo sub [AB] ${run}$`) });
  await expect(names).toHaveText([subA, subB]);
  await page.getByRole("button", { name: `Move up: ${subB}` }).click();
  await expect(names).toHaveText([subB, subA]);
  await expect(page.getByRole("button", { name: `Move up: ${subB}` })).toBeDisabled();
  await expectAxeClean(page);
});

test("owner: put a product in a sub-category; a category in use can't be deleted", async ({
  page,
  context,
}) => {
  await signIn(context);
  await page.goto(`${PLATFORM}/products/${productId}`, { waitUntil: "networkidle" });
  await page.getByRole("checkbox", { name: subA }).check();
  await page.getByRole("button", { name: "Save categories" }).click();
  await expect(page.getByText("Categories saved")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: subA })).toBeChecked();
  await expectAxeClean(page);

  await page.goto(`${PLATFORM}/categories`, { waitUntil: "networkidle" });
  await tree(page).getByRole("link", { name: subA }).click();
  await expect(page.getByRole("heading", { name: subA, level: 1 })).toBeVisible();
  await expect(page.getByText("Only an empty category can be deleted.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete this category" })).toHaveCount(0);
  await expectAxeClean(page);

  // the other, empty sub-category can go
  await page.goto(`${PLATFORM}/categories`, { waitUntil: "networkidle" });
  await tree(page).getByRole("link", { name: subB }).click();
  await page.getByRole("button", { name: "Delete this category" }).click();
  await expect(page.getByText("Category deleted")).toBeVisible();
  await expect(tree(page).getByRole("link", { name: subB })).toHaveCount(0);

  const [audit] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM audit.events
    WHERE actor_id = ${userId} AND action LIKE 'catalog.%'`;
  // 3 created, 1 moved, 1 product's categories set, 1 deleted
  expect(audit?.n).toBe(6);
});
