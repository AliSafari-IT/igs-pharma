import { createHmac, randomInt, randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { type BrowserContext, type Page, expect, test } from "@playwright/test";
import postgres from "postgres";

import { smokeDatabaseUrl, smokeEnv } from "../smoke-env";

/**
 * igs-pharma#187 (REQ-SAF-01): a pharmacist starts a recall from a product's stock page, sees the
 * product stop selling and its lot in quarantine, then ends the recall; an owner can't start one.
 * Needs SMOKE_DATABASE_URL (a migrated database).
 */
test.skip(!smokeDatabaseUrl, "set SMOKE_DATABASE_URL to a migrated database to run");

const PLATFORM = "http://localhost:3001";

let sql: postgres.Sql;
const userIds: string[] = [];
const tokens: Record<"pharmacist" | "owner", string> = { pharmacist: "", owner: "" };
let productId: string;
// a fake CNK no seed uses (the synthetic seed uses 0000001–0000020)
const cnk = `97${String(randomInt(0, 100_000)).padStart(5, "0")}`;
const nameNl = `Demo E2E recall ${randomUUID().slice(0, 8)}`;

/** Better Auth's signed session cookie: `<token>.<base64 HMAC-SHA256>`, URI-encoded (better-call). */
const signed = (value: string) =>
  encodeURIComponent(
    `${value}.${createHmac("sha256", smokeEnv.AUTH_SECRET).update(value).digest("base64")}`,
  );

async function signIn(context: BrowserContext, as: keyof typeof tokens) {
  await context.addCookies([
    { name: "better-auth.session_token", value: signed(tokens[as]), url: PLATFORM },
  ]);
}

async function expectAxeClean(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

async function staffWith(role: "pharmacist" | "owner"): Promise<string> {
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO identity.users (id, name, email, email_verified, kind)
    VALUES (gen_random_uuid(), ${`Recall ${role}`}, ${`${randomUUID()}@example.test`}, true, 'staff')
    RETURNING id`;
  const id = (user as { id: string }).id;
  userIds.push(id);
  await sql`
    INSERT INTO identity.user_roles (id, user_id, role_key, location_id)
    VALUES (gen_random_uuid(), ${id}, ${role}, NULL)`;
  await sql`
    INSERT INTO identity.passkeys (id, user_id, public_key, credential_id, counter, device_type, backed_up)
    VALUES (gen_random_uuid(), ${id}, 'pk', ${randomUUID()}, 0, 'singleDevice', false)`;
  const token = randomUUID();
  await sql`
    INSERT INTO identity.sessions (id, user_id, token, expires_at, mfa_verified_at)
    VALUES (gen_random_uuid(), ${id}, ${token}, now() + interval '1 hour', now())`;
  return token;
}

test.beforeAll(async () => {
  // the same TLS the production build insists on (see smoke-env.ts)
  sql = postgres(smokeDatabaseUrl as string, { max: 1, ssl: "require", onnotice: () => {} });
  tokens.pharmacist = await staffWith("pharmacist");
  tokens.owner = await staffWith("owner");
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
  // a recall and its stop-sale are kept (the database refuses deleting them), so the product stays
  if (productId) await sql`UPDATE catalog.products SET status = 'archived' WHERE id = ${productId}`;
  for (const id of userIds) await sql`DELETE FROM identity.users WHERE id = ${id}`;
  await sql?.end({ timeout: 5 });
});

test.describe.configure({ mode: "serial" });

test("owner: no recall button on the stock page", async ({ page, context }) => {
  await signIn(context, "owner");
  await page.goto(`${PLATFORM}/stock/${productId}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: nameNl, level: 1 })).toBeVisible();
  await expect(page.getByTestId("recall-open")).toHaveCount(0);
});

test("pharmacist: start a recall, see the product stop selling, then end it", async ({
  page,
  context,
}) => {
  await signIn(context, "pharmacist");
  await page.goto(`${PLATFORM}/stock/${productId}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Receive stock" }).click();
  const receive = page.getByRole("dialog", { name: "Receive stock" });
  await receive.getByLabel("Quantity").fill("4");
  await receive.getByRole("button", { name: "Receive" }).click();
  await expect(page.getByTestId("on-hand")).toHaveText("4");

  await page.getByTestId("recall-open").click();
  const start = page.getByRole("dialog", { name: "Start a recall" });
  await start.getByLabel("Called by").selectOption("manufacturer");
  await start.getByLabel("Reference and reason").fill("E2E notice 1, batch contamination");
  await start.getByRole("button", { name: "Start the recall" }).click();

  await expect(page.getByRole("heading", { name: `Recall: ${nameNl}`, level: 1 })).toBeVisible();
  await expect(page.getByText("The recall started")).toBeVisible();
  await expect(page.getByTestId("recall-active")).toBeVisible();
  await expect(page.getByTestId("recall-note")).toHaveText("E2E notice 1, batch contamination");
  await expect(page.getByTestId("recall-lots").locator("tbody tr")).toHaveCount(1);
  await expectAxeClean(page);

  await page.goto(`${PLATFORM}/stock/${productId}`, { waitUntil: "networkidle" });
  await expect(page.getByTestId("recalled")).toBeVisible();
  await expect(page.getByTestId("sellable")).toHaveText("0");
  await expect(page.getByTestId("recall-open")).toHaveCount(0);

  await page.goto(`${PLATFORM}/recalls`, { waitUntil: "networkidle" });
  const row = page.getByTestId("recalls").locator("tbody tr", { hasText: nameNl });
  await expect(row).toContainText("Active: not selling");
  await expectAxeClean(page);
  await row.getByRole("link", { name: nameNl }).click();

  await page.getByTestId("recall-end-open").click();
  await page
    .getByRole("dialog", { name: "End the recall" })
    .getByRole("button", { name: "End the recall" })
    .click();
  await expect(page.getByText("The recall ended")).toBeVisible();
  await expect(page.getByTestId("recall-active")).toHaveCount(0);
  await expect(page.getByTestId("recall-end-open")).toHaveCount(0);
});
