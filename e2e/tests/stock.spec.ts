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
test.skip(!smokeDatabaseUrl, "set SMOKE_DATABASE_URL to a migrated database to run");

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
  page.getByLabel("Count file (CSV)").setInputFiles({
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

test("owner: a count file with an unknown CNK or lot counts nothing", async ({ page, context }) => {
  await signIn(context);
  await page.goto(`${PLATFORM}/stock`, { waitUntil: "networkidle" });
  await upload(page, `cnk;lot;expiry;counted\n${cnk};;;5\n9599999;;;1\n`);
  await page.getByRole("button", { name: "Preview the count" }).click();
  // the product has no stock yet, so no untracked lot to count (igs-pharma#166)
  await expect(
    page.getByText("Line 2: This lot is not in the web stock.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("Line 3: No product in the catalogue has this CNK.")).toBeVisible();
  await expect(page).toHaveURL(`${PLATFORM}/stock`);
  await expectAxeClean(page);

  await page.goto(`${PLATFORM}/stock?q=zz-no-match`, { waitUntil: "networkidle" });
  await expect(page.getByTestId("stock-empty")).toHaveText("No products match “zz-no-match”");
  await expect(page.getByRole("table")).toHaveCount(0);
  // #104: "Clear search" goes back to the whole list
  await page.getByTestId("clear-search").click();
  await expect(page).toHaveURL(`${PLATFORM}/stock`);
  await expect(page.getByTestId("clear-search")).toHaveCount(0);
});

test("owner: receive, adjust, then count the lots and see on-hand and history", async ({
  page,
  context,
}) => {
  await signIn(context);
  await page.goto(`${PLATFORM}/stock?q=${cnk}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Stock", level: 1 })).toBeVisible();
  const row = page.locator("tbody tr").first();
  await expect(row).toContainText(nameNl);
  await expect(row).toContainText("Never");
  await expectAxeClean(page);
  await row.getByRole("link", { name: cnk }).click();
  await expect(page.getByRole("heading", { name: nameNl, level: 1 })).toBeVisible();
  await expect(page.getByTestId("reservations-empty")).toHaveText("Nothing is set aside");

  // untracked stock of a non-medicine goes into its "No lot" lot (igs-pharma#164)
  await page.getByRole("button", { name: "Receive stock" }).click();
  const receive = page.getByRole("dialog", { name: "Receive stock" });
  await receive.getByLabel("Quantity").fill("12");
  await receive.getByRole("button", { name: "Receive" }).click();
  await expect(page.getByText("The stock was received into its lot.")).toBeVisible();
  await expect(page.getByTestId("on-hand")).toHaveText("12");
  const movements = page.getByRole("region", { name: "Movements" }).locator("tbody tr");
  await expect(movements).toHaveCount(1);
  const lots = page.getByRole("region", { name: "Lots" }).locator("tbody tr");
  await expect(lots).toHaveCount(1);
  await expect(lots.first()).toContainText("No lot");
  await expect(lots.first()).toContainText("Sellable");
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
  await expect(movements.first()).toContainText("Broken boxes");

  // a receipt into a lot of its own
  await page.getByRole("button", { name: "Receive stock" }).click();
  await receive.getByLabel("Quantity").fill("3");
  await receive.getByLabel("Lot number (optional)").fill("E2E-1");
  await receive.getByLabel("Expiry date (optional)").fill("2099-12-31");
  await receive.getByRole("button", { name: "Receive" }).click();
  await expect(page.getByTestId("on-hand")).toHaveText("13");
  await expect(lots).toHaveCount(2);

  // a count file: previewed per lot, nothing changes until it is applied (igs-pharma#166)
  await page.goto(`${PLATFORM}/stock`, { waitUntil: "networkidle" });
  await upload(page, `cnk;lot;expiry;counted\n${cnk};;;9\n${cnk};E2E-1;;3\n`);
  await page.getByRole("button", { name: "Preview the count" }).click();
  await expect(page.getByRole("heading", { name: "Stock count", level: 1 })).toBeVisible();
  await expect(page.getByTestId("count-status")).toHaveText("Preview: nothing has changed yet");
  await expect(page.getByText("1 lot will change when you apply the count.")).toBeVisible();
  const counted = page.getByRole("table", { name: "Counted lots" }).locator("tbody tr");
  await expect(counted).toHaveCount(2);
  await expect(counted.nth(0)).toContainText("-1");
  await expect(counted.nth(1)).toContainText("No change");
  await expectAxeClean(page);
  await page.getByRole("button", { name: "Apply the count" }).click();
  await expect(page.getByText("1 lot changed.")).toBeVisible();
  await expect(page.getByTestId("count-status")).toHaveText("Applied");
  await expect(page.getByRole("button", { name: "Apply the count" })).toHaveCount(0);

  await page.goto(`${PLATFORM}/stock/${productId}`, { waitUntil: "networkidle" });
  await expect(page.getByTestId("on-hand")).toHaveText("12");
  await expect(movements.first()).toContainText("Stock count");

  // a typed count of the product's lots, discarded: nothing changes
  await page.getByRole("button", { name: "Count", exact: true }).click();
  const count = page.getByRole("dialog", { name: "Count the lots" });
  await count.getByLabel(/^E2E-1/).fill("1");
  await expectAxeClean(page);
  await count.getByRole("button", { name: "Preview the count" }).click();
  await expect(page.getByTestId("count-status")).toHaveText("Preview: nothing has changed yet");
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByTestId("count-status")).toHaveText("Discarded");
  await page.goto(`${PLATFORM}/stock/${productId}`, { waitUntil: "networkidle" });
  await expect(page.getByTestId("on-hand")).toHaveText("12");

  const [audit] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM audit.events
    WHERE actor_id = ${userId}
      AND action IN ('inventory.reconciliation.applied', 'inventory.reconciliation.discarded', 'inventory.stock.adjusted')`;
  expect(audit?.n).toBe(3);
});
