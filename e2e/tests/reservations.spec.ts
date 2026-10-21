import { createHmac, randomInt, randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { type BrowserContext, type Page, expect, test } from "@playwright/test";
import postgres from "postgres";

import { smokeDatabaseUrl, smokeEnv } from "../smoke-env";

/**
 * igs-pharma#99: stock reservations in the back-office, against the production build. The Stock list
 * shows reserved and available per product, with a "Short by" flag when the orders set aside more
 * than the shelf holds; the product page lists what is set aside (kind, age, expiry) and staff
 * release a reservation with a reason, which is audited. There is no screen that creates one: the
 * rows are written the way the checkout will write them. Needs SMOKE_DATABASE_URL (a migrated database).
 */
test.skip(!smokeDatabaseUrl, "set SMOKE_DATABASE_URL to a migrated database to run");

const PLATFORM = "http://localhost:3001";
const LOCATION = "0192f000-0000-7000-8000-000000000001";
const tag = randomUUID().slice(0, 8);

/** A holder reference the way the checkout will write it: `checkout:<uuidv7>` or `order:<uuidv7>`. */
const holderRef = (kind: "checkout" | "order") =>
  `${kind}:00000000-0000-7000-8000-${randomUUID().replaceAll("-", "").slice(0, 12)}`;

let sql: postgres.Sql;
let userId: string;
let token: string;
const products: string[] = [];
// fake CNKs no seed uses (the synthetic seed uses 0000001–0000020)
const cnkOf = () => `97${String(randomInt(0, 100_000)).padStart(5, "0")}`;

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

/** A catalog product with `onHand` units on the shelf. */
async function product(name: string, onHand: number) {
  const cnk = cnkOf();
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO catalog.products (id, cnk, product_type, legal_status, vat_class)
    VALUES (gen_random_uuid(), ${cnk}, 'general', 'general_sale', 'BE_21')
    RETURNING id`;
  const id = (row as { id: string }).id;
  products.push(id);
  await sql`
    INSERT INTO catalog.product_content (product_id, locale, name, source)
    VALUES (${id}, 'nl', ${name}, 'manual')`;
  await sql`
    WITH lot AS (
      INSERT INTO inventory.lots (id, product_id, location_id, tracking, created_by_type, created_by_id)
      VALUES (gen_random_uuid(), ${id}, ${LOCATION}::uuid, 'no_lot', 'system', 'e2e')
      ON CONFLICT DO NOTHING RETURNING id
    )
    INSERT INTO inventory.stock_movements (id, product_id, location_id, lot_id, delta, reason, actor_type, actor_id)
    VALUES (gen_random_uuid(), ${id}, ${LOCATION}::uuid,
      coalesce((SELECT id FROM lot), (SELECT id FROM inventory.lots
        WHERE product_id = ${id} AND location_id = ${LOCATION}::uuid AND tracking = 'no_lot')),
      ${onHand}, 'import', 'system', 'e2e')`;
  return { id, cnk, name };
}

/** A reservation, written the way the checkout will write it. */
async function reserve(
  productId: string,
  kind: "hold" | "order",
  quantity: number,
  holderRef: string,
  minutesAgo = 5,
) {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO inventory.reservations
      (id, product_id, location_id, quantity, kind, holder_ref, status, expires_at, created_at,
       created_by_type, created_by_id, updated_by_type, updated_by_id)
    VALUES (gen_random_uuid(), ${productId}, ${LOCATION}, ${quantity}, ${kind}, ${holderRef}, 'active',
      ${kind === "hold" ? sql`now() + interval '10 minutes'` : null},
      now() - ${`${minutesAgo} minutes`}::interval, 'system', 'checkout', 'system', 'checkout')
    RETURNING id`;
  return (row as { id: string }).id;
}

test.beforeAll(async () => {
  // the same TLS the production build insists on (see smoke-env.ts)
  sql = postgres(smokeDatabaseUrl as string, { max: 1, ssl: "require", onnotice: () => {} });
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO identity.users (id, name, email, email_verified, kind)
    VALUES (gen_random_uuid(), 'Reservation Owner', ${`${randomUUID()}@example.test`}, true, 'staff')
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
  // movements and reservations are kept (append-only / no DELETE); they reference no table
  for (const id of products) await sql`DELETE FROM catalog.products WHERE id = ${id}`;
  if (userId) await sql`DELETE FROM audit.events WHERE actor_id = ${userId}`.catch(() => {});
  if (userId) await sql`DELETE FROM identity.users WHERE id = ${userId}`;
  await sql?.end({ timeout: 5 });
});

test.describe.configure({ mode: "serial" });

let shelf: { id: string; cnk: string; name: string };
let holdId: string;

test("the list shows what is on hand, reserved and available", async ({ page, context }) => {
  shelf = await product(`Demo E2E reserved ${tag}`, 10);
  holdId = await reserve(shelf.id, "hold", 3, holderRef("checkout"), 2);
  await reserve(shelf.id, "order", 4, holderRef("order"), 90);
  await signIn(context);
  await page.goto(`${PLATFORM}/stock?q=${shelf.cnk}`, { waitUntil: "networkidle" });
  const row = page.locator("tbody tr").first();
  await expect(row).toContainText(shelf.name);
  const cells = row.locator("td");
  await expect(cells.nth(2)).toHaveText("10"); // on hand
  await expect(cells.nth(3)).toHaveText("7"); // reserved: 3 in a checkout + 4 in an order
  await expect(cells.nth(4)).toHaveText("3"); // available
  await expect(row).not.toContainText("Short by");
  await expectAxeClean(page);
});

test("the product page lists what is set aside, with kind, age and expiry", async ({
  page,
  context,
}) => {
  await signIn(context);
  await page.goto(`${PLATFORM}/stock/${shelf.id}`, { waitUntil: "networkidle" });
  await expect(page.getByTestId("on-hand")).toHaveText("10");
  await expect(page.getByTestId("held")).toHaveText("3");
  await expect(page.getByTestId("ordered")).toHaveText("4");
  await expect(page.getByTestId("available")).toHaveText("3");
  const table = page.getByRole("region", { name: "Set aside" }).getByRole("table");
  await expect(table.locator("tbody tr")).toHaveCount(2);
  const order = table
    .locator("tbody tr")
    .filter({ has: page.getByRole("cell", { name: "Order", exact: true }) });
  await expect(order).toContainText("4");
  await expect(order).toContainText("Never"); // an order does not expire
  await expect(order).toContainText("1 h 30 min");
  const hold = table.locator("tbody tr", { hasText: "Checkout in progress" });
  await expect(hold).toContainText("3");
  await expect(hold).not.toContainText("Never");
  await expectAxeClean(page);
});

test("Release needs a reason, gives the stock back and is audited", async ({ page, context }) => {
  await signIn(context);
  await page.goto(`${PLATFORM}/stock/${shelf.id}`, { waitUntil: "networkidle" });
  const hold = page.locator("tbody tr", { hasText: "Checkout in progress" });
  await hold.getByRole("button", { name: "Release" }).click();
  const dialog = page.getByRole("dialog", { name: "Release 3 set aside" });
  await expect(dialog.getByLabel("Reason")).toBeVisible();
  await expectAxeClean(page);
  await dialog.getByLabel("Reason").selectOption("checkout_cancelled");
  await dialog.getByRole("button", { name: "Release" }).click();

  await expect(
    page.getByText("The reservation ended and its stock is available again."),
  ).toBeVisible();
  await expect(page.getByTestId("available")).toHaveText("6");
  await expect(page.getByTestId("held")).toHaveText("0");
  await expect(page.locator("tbody tr", { hasText: "Checkout in progress" })).toHaveCount(0);

  const [reservation] = await sql<{ status: string; release_reason: string }[]>`
    SELECT status, release_reason FROM inventory.reservations WHERE id = ${holdId}`;
  expect(reservation).toEqual({ status: "released", release_reason: "checkout_cancelled" });
  const events = await sql<{ actor_id: string; data: Record<string, unknown> }[]>`
    SELECT actor_id, data FROM audit.events
    WHERE action = 'inventory.reservation.released' AND entity_id = ${shelf.id}`;
  expect(events).toEqual([
    {
      actor_id: userId,
      data: {
        reservationId: holdId,
        productId: shelf.id,
        quantity: 3,
        reason: "checkout_cancelled",
      },
    },
  ]);
});

test("a reservation that ended meanwhile is explained, not released twice", async ({
  page,
  context,
}) => {
  const other = await product(`Demo E2E stale ${tag}`, 5);
  const id = await reserve(other.id, "order", 2, holderRef("order"));
  await signIn(context);
  await page.goto(`${PLATFORM}/stock/${other.id}`, { waitUntil: "networkidle" });
  // someone else released it while the page was open
  await sql`
    UPDATE inventory.reservations SET status = 'released', release_reason = 'order_cancelled'
    WHERE id = ${id}`;
  await page
    .getByRole("region", { name: "Set aside" })
    .locator("tbody tr")
    .first()
    .getByRole("button", { name: "Release" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Release" }).click();
  await expect(dialog.getByText("This reservation has already ended")).toBeVisible();
});

test("orders for more than the shelf holds show the product as short", async ({
  page,
  context,
}) => {
  const short = await product(`Demo E2E short ${tag}`, 5);
  await reserve(short.id, "order", 8, holderRef("order"), 30);
  await signIn(context);
  await page.goto(`${PLATFORM}/stock?q=${short.cnk}`, { waitUntil: "networkidle" });
  const row = page.locator("tbody tr").first();
  await expect(row).toContainText("Short by 3");
  await expectAxeClean(page);
  await page.goto(`${PLATFORM}/stock/${short.id}`, { waitUntil: "networkidle" });
  await expect(page.getByText("Short by 3", { exact: true })).toBeVisible();
  await expect(page.getByTestId("available")).toHaveText("0");
  await expectAxeClean(page);
});
