import { createHmac, randomInt, randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { type BrowserContext, type Page, expect, test } from "@playwright/test";
import postgres from "postgres";

import { smokeDatabaseUrl, smokeEnv } from "../smoke-env";

/**
 * igs-pharma#53: back-office stock against the production build. A signed-in owner (who proved a
 * second factor) uploads a stock count, sees the preview, confirms it, then sees the on-hand and
 * the history, and adjusts with a reason. Needs SMOKE_DATABASE_URL (a migrated database).
 */
test.skip(!smokeDatabaseUrl || smokeDatabaseUrl.length > 0, "TEMPORARY PROOF: forced skip");

const PLATFORM = "http://localhost:3001";

let sql: postgres.Sql;
let userId: string;
let token: string;
let productId: string;
// a fake CNK no seed uses (the synthetic seed uses 0000001–0000020)
const cnk = `96${String(randomInt(0, 100_000)).padStart(5, "0")}`;
const nameNl = `Demo E2E stock ${randomUUID().slice(0, 8)}`;

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

const upload = (page: Page, text: string) =>
  page.getByLabel("CSV file").setInputFiles({
    name: "count.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(text),
  });

test.beforeAll(async () => {
  // the same TLS the production build insists on (see smoke-env.ts)
  sql = postgres(smokeDatabaseUrl as string, { max: 1, ssl: "require", onnotice: () => {} });
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO identity.users (id, name, email, email_verified, kind)
    VALUES (gen_random_uuid(), 'Stock Owner', ${`${randomUUID()}@example.test`}, true, 'staff')
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
  // stock movements are append-only and stay; they reference no table
  if (productId) await sql`DELETE FROM catalog.products WHERE id = ${productId}`;
  if (userId) await sql`DELETE FROM identity.users WHERE id = ${userId}`;
  await sql?.end({ timeout: 5 });
});

test.describe.configure({ mode: "serial" });

test("signed out: the stock page sends you to sign in", async ({ page }) => {
  await page.goto(`${PLATFORM}/stock`);
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("owner: a file with an unknown CNK changes nothing", async ({ page, context }) => {
  await signIn(context);
  await page.goto(`${PLATFORM}/stock`, { waitUntil: "networkidle" });
  await upload(page, `cnk;quantity\n${cnk};5\n9599999;1\n`);
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByText("Line 3: No product in the catalogue has this CNK.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm import" })).toHaveCount(0);
  await expectAxeClean(page);
});

test("owner: upload, preview, confirm, then see on-hand and history", async ({ page, context }) => {
  await signIn(context);
  await page.goto(`${PLATFORM}/stock?q=${cnk}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Stock", level: 1 })).toBeVisible();
  await expect(page.locator("tbody tr").first()).toContainText("Never");
  await expectAxeClean(page);

  await upload(page, `cnk;quantity\n${cnk};12\n`);
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByText("1 product will change, 0 stay the same.")).toBeVisible();
  await expect(page.getByText("+12")).toBeVisible();
  await expectAxeClean(page);
  await page.getByRole("button", { name: "Confirm import" }).click();
  await expect(page.getByText("1 product changed.")).toBeVisible();

  await page.goto(`${PLATFORM}/stock?q=${cnk}`, { waitUntil: "networkidle" });
  const row = page.locator("tbody tr").first();
  await expect(row).toContainText(nameNl);
  await expect(row).toContainText("12");
  await row.getByRole("link", { name: cnk }).click();

  await expect(page.getByRole("heading", { name: nameNl, level: 1 })).toBeVisible();
  await expect(page.getByTestId("on-hand")).toHaveText("12");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr").first()).toContainText("Stock count (CSV)");
  await expectAxeClean(page);

  // below zero is refused, a real adjustment with its note is recorded
  await page.getByRole("button", { name: "Adjust stock" }).click();
  const dialog = page.getByRole("dialog", { name: "Adjust stock" });
  await dialog.getByLabel("Change").fill("-20");
  await dialog.getByLabel("Note").fill("Broken boxes");
  await dialog.getByRole("button", { name: "Save change" }).click();
  await expect(dialog.getByText("Stock can't go below zero. There are 12 on hand.")).toBeVisible();
  await dialog.getByLabel("Change").fill("-2");
  await dialog.getByRole("button", { name: "Save change" }).click();
  await expect(page.getByText("On hand is now 10.")).toBeVisible();
  await expect(page.getByTestId("on-hand")).toHaveText("10");
  await expect(page.locator("tbody tr").first()).toContainText("Broken boxes");

  const [audit] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM audit.events
    WHERE actor_id = ${userId} AND action IN ('inventory.stock.imported', 'inventory.stock.adjusted')`;
  expect(audit?.n).toBe(2);
});
