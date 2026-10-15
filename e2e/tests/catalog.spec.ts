import { createHmac, randomInt, randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { type BrowserContext, type Page, expect, test } from "@playwright/test";
import postgres from "postgres";

import { smokeDatabaseUrl, smokeEnv } from "../smoke-env";

/**
 * igs-pharma#50: the back-office catalogue against the production build. A signed-in owner (who
 * proved a second factor) sees the product list, creates a product with Dutch and French content
 * and makes it active. Needs SMOKE_DATABASE_URL (a migrated database); skipped without it.
 */
test.skip(!smokeDatabaseUrl, "set SMOKE_DATABASE_URL to a migrated database to run");

const PLATFORM = "http://localhost:3001";

let sql: postgres.Sql;
let userId: string;
let token: string;
// a fake CNK no seed uses (the synthetic seed uses 0000001–0000020)
const cnk = `98${String(randomInt(0, 100_000)).padStart(5, "0")}`;
const nameNl = `Demo E2E ${randomUUID().slice(0, 8)}`;

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

test.beforeAll(async () => {
  // the same TLS the production build insists on (see smoke-env.ts)
  sql = postgres(smokeDatabaseUrl as string, { max: 1, ssl: "require", onnotice: () => {} });
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO identity.users (id, name, email, email_verified, kind)
    VALUES (gen_random_uuid(), 'Catalogue Owner', ${`${randomUUID()}@example.test`}, true, 'staff')
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
});

test.afterAll(async () => {
  if (sql) await sql`DELETE FROM catalog.products WHERE cnk = ${cnk}`;
  if (userId) await sql`DELETE FROM identity.users WHERE id = ${userId}`;
  await sql?.end({ timeout: 5 });
});

test.describe.configure({ mode: "serial" });

test("signed out: the product list sends you to sign in", async ({ page }) => {
  await page.goto(`${PLATFORM}/products`);
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("owner: list, create with Dutch and French, then make active", async ({ page, context }) => {
  await signIn(context);
  await page.goto(`${PLATFORM}/products`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Products", level: 1 })).toBeVisible();
  await expectAxeClean(page);

  await page.getByRole("link", { name: "New product" }).click();
  await expect(page.getByRole("heading", { name: "New product" })).toBeVisible();

  // a bad CNK is refused with a field message, and what was typed stays
  await page.getByLabel("CNK").fill("12345");
  await page.getByLabel("Name (Dutch)").fill(nameNl);
  await page.getByRole("button", { name: "Create product" }).click();
  await expect(page.getByText("Enter exactly 7 digits.")).toBeVisible();
  await expect(page.getByLabel("Name (Dutch)")).toHaveValue(nameNl);
  await expectAxeClean(page);

  await page.getByLabel("CNK").fill(cnk);
  // the regulated fields are a pharmacist's (igs-pharma#79): the owner sees them read-only
  await expect(page.getByLabel("VAT")).toBeDisabled();
  await expect(page.getByLabel("VAT")).toHaveValue("BE_21");
  await expect(page.getByText(/set by a pharmacist/)).toBeVisible();
  await page.getByRole("tab", { name: /French/ }).click();
  await page.getByLabel("Name (French)").fill(`Démo E2E ${cnk}`);
  await page.getByRole("button", { name: "Create product" }).click();

  await expect(page.getByText("Product saved")).toBeVisible();
  await expect(page.getByRole("heading", { name: nameNl, level: 1 })).toBeVisible();
  await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();
  await expectAxeClean(page);

  await page.getByRole("button", { name: "Make active" }).click();
  await expect(page.getByText("Status changed to active")).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to draft" })).toBeVisible();

  await page.goto(`${PLATFORM}/products?q=${cnk}`, { waitUntil: "networkidle" });
  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(cnk);
  await expect(rows.first()).toContainText(nameNl);
  await expect(rows.first()).toContainText("Active");

  await page.goto(`${PLATFORM}/products?q=zz-no-match`, { waitUntil: "networkidle" });
  await expect(page.getByTestId("products-empty")).toHaveText("No products match “zz-no-match”");

  const [audit] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM audit.events
    WHERE actor_id = ${userId} AND action IN ('catalog.product.created', 'catalog.product.status_changed')`;
  expect(audit?.n).toBe(2);
});

test("a product with only Dutch content cannot be made active", async ({ page, context }) => {
  await signIn(context);
  await page.goto(`${PLATFORM}/products/new`, { waitUntil: "networkidle" });
  const draftCnk = `97${String(randomInt(0, 100_000)).padStart(5, "0")}`;
  await page.getByLabel("CNK").fill(draftCnk);
  await page.getByLabel("Name (Dutch)").fill(`Demo E2E only Dutch ${draftCnk}`);
  await page.getByRole("button", { name: "Create product" }).click();
  await expect(page.getByText("Product saved")).toBeVisible();
  await expect(page.getByText("To make it active, add a name in French.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Make active" })).toBeDisabled();
  await sql`DELETE FROM catalog.products WHERE cnk = ${draftCnk}`;
});
