import { createHmac, randomInt, randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { type BrowserContext, type Page, expect, test } from "@playwright/test";
import postgres from "postgres";

import { smokeDatabaseUrl, smokeEnv } from "../smoke-env";

/**
 * igs-pharma#59: back-office prices against the production build. A signed-in owner (who proved a
 * second factor) gives a product a price, schedules another for tomorrow, sees both in the Price
 * panel, and sees the price in the product list. Needs SMOKE_DATABASE_URL (a migrated database).
 */
test.skip(!smokeDatabaseUrl, "set SMOKE_DATABASE_URL to a migrated database to run");

const PLATFORM = "http://localhost:3001";

let sql: postgres.Sql;
let userId: string;
let token: string;
let productId: string;
// a fake CNK no seed uses (the synthetic seed uses 0000001–0000020)
const cnk = `95${String(randomInt(0, 100_000)).padStart(5, "0")}`;
const nameNl = `Demo E2E price ${randomUUID().slice(0, 8)}`;

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

/** Tomorrow at 09:00 in Brussels, as a `datetime-local` value. */
const tomorrowAtNine = () =>
  `${new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels" }).format(
    new Date(Date.now() + 86_400_000),
  )}T09:00`;

test.beforeAll(async () => {
  // the same TLS the production build insists on (see smoke-env.ts)
  sql = postgres(smokeDatabaseUrl as string, { max: 1, ssl: "require", onnotice: () => {} });
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO identity.users (id, name, email, email_verified, kind)
    VALUES (gen_random_uuid(), 'Price Owner', ${`${randomUUID()}@example.test`}, true, 'staff')
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
  // prices are append-only and stay; they reference no table
  if (productId) await sql`DELETE FROM catalog.products WHERE id = ${productId}`;
  if (userId) await sql`DELETE FROM identity.users WHERE id = ${userId}`;
  await sql?.end({ timeout: 5 });
});

test.describe.configure({ mode: "serial" });

test("owner: set a price, schedule another, see both and the list's Price column", async ({
  page,
  context,
}) => {
  await signIn(context);
  await page.goto(`${PLATFORM}/products/${productId}`, { waitUntil: "networkidle" });
  const panel = page.getByRole("region", { name: "Price" });
  await expect(panel.getByText("No price yet", { exact: true })).toBeVisible();
  await expect(panel.getByText("21 %", { exact: true })).toBeVisible();
  await expectAxeClean(page);

  // a typo is refused, then a price from now
  await panel.getByRole("button", { name: "Change price" }).click();
  let dialog = page.getByRole("dialog", { name: "Change price" });
  await dialog.getByLabel("New price in euros, VAT included").fill("5,999");
  await dialog.getByRole("button", { name: "Save price" }).click();
  await expect(dialog.getByText("with at most two decimals")).toBeVisible();
  await expectAxeClean(page);
  await dialog.getByLabel("New price in euros, VAT included").fill("5,99");
  await dialog.getByLabel("Reason (optional)").fill("Launch price");
  await dialog.getByRole("button", { name: "Save price" }).click();
  await expect(page.getByText("Price changed")).toBeVisible();
  await expect(panel.getByText("€5.99", { exact: true })).toBeVisible();
  await expect(panel.getByText("incl. 21 % VAT, €1.04")).toBeVisible();

  // a change for tomorrow morning
  await panel.getByRole("button", { name: "Change price" }).click();
  dialog = page.getByRole("dialog", { name: "Change price" });
  await expect(dialog.getByText("Price now: €5.99")).toBeVisible();
  await dialog.getByLabel("New price in euros, VAT included").fill("6.49");
  await dialog.getByLabel("From a date and time").check();
  await dialog.getByLabel("Date and time (Brussels)").fill(tomorrowAtNine());
  await dialog.getByRole("button", { name: "Save price" }).click();
  await expect(page.getByText("Price change scheduled")).toBeVisible();

  const scheduled = panel.getByRole("table", { name: "Scheduled changes" });
  await expect(scheduled.locator("tbody tr")).toHaveCount(1);
  await expect(scheduled.locator("tbody tr").first()).toContainText("€5.99 → €6.49");
  await expect(scheduled.locator("tbody tr").first()).toContainText("You");
  const history = panel.getByRole("table", { name: "Price history" });
  await expect(history.locator("tbody tr")).toHaveCount(1);
  await expect(history.locator("tbody tr").first()).toContainText("First price: €5.99");
  await expect(history.locator("tbody tr").first()).toContainText("Launch price");
  // still today's price until tomorrow
  await expect(panel.getByText("€5.99", { exact: true })).toBeVisible();
  await expectAxeClean(page);

  await page.goto(`${PLATFORM}/products?q=${cnk}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("columnheader", { name: "Price" })).toBeVisible();
  await expect(page.locator("tbody tr").first()).toContainText("€5.99");
  await expectAxeClean(page);

  const [audit] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM audit.events
    WHERE actor_id = ${userId} AND action = 'pricing.price.set'`;
  expect(audit?.n).toBe(2);
});
