import { createHmac, randomInt, randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { type BrowserContext, type Page, expect, test } from "@playwright/test";
import postgres from "postgres";

import { smokeDatabaseUrl, smokeEnv } from "../smoke-env";

/** igs-pharma#116: back-office orders: the review queue, the pharmacist's approval, fulfilment steps. */
test.skip(!smokeDatabaseUrl, "set SMOKE_DATABASE_URL to a migrated database to run");

const PLATFORM = "http://localhost:3001";

let sql: postgres.Sql;
const userIds: string[] = [];
let pharmacistToken: string;
let assistantToken: string;
let supportToken: string;
let orderId: string;
let reference: string;

const signed = (value: string) =>
  encodeURIComponent(
    `${value}.${createHmac("sha256", smokeEnv.AUTH_SECRET).update(value).digest("base64")}`,
  );

async function signIn(context: BrowserContext, token: string) {
  await context.clearCookies();
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

async function staffMember(name: string, role: string): Promise<string> {
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO identity.users (id, name, email, email_verified, kind)
    VALUES (gen_random_uuid(), ${name}, ${`${randomUUID()}@example.test`}, true, 'staff')
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

const LOCATION = "0192f000-0000-7000-8000-000000000001";
/** A UUIDv7-shaped id, as the checkout writes them (the inventory holder reference needs one). */
const uuidv7 = () => `0192f000-0000-7000-8000-${randomUUID().replaceAll("-", "").slice(0, 12)}`;

/**
 * A paid guest order holding one medicine, waiting for the pharmacist: its stock set aside the way
 * a payment leaves it, an order reservation allocated to a lot (igs-pharma#165).
 */
async function paidMedicineOrder(): Promise<void> {
  orderId = randomUUID();
  const checkoutId = uuidv7();
  reference = `IGS-2026-${String(randomInt(900_000, 999_999))}`;
  // a sellable medicine: active, with its nl and fr text approved by a pharmacist (the eligibility
  // recheck asks the catalogue again before the approval and every fulfilment step)
  const cnk = `98${String(randomInt(0, 100_000)).padStart(5, "0")}`;
  const [product] = await sql<{ id: string }[]>`
    INSERT INTO catalog.products (id, cnk, product_type, legal_status, vat_class, status)
    VALUES (gen_random_uuid(), ${cnk}, 'otc_medicine', 'otc', 'BE_6', 'draft')
    RETURNING id`;
  const productId = (product as { id: string }).id;
  await sql`
    INSERT INTO catalog.product_content (product_id, locale, name, source, approved_by, approved_at)
    VALUES (${productId}, 'nl', 'Paracetamol 500 mg', 'manual', ${userIds[0] as string}, now()),
      (${productId}, 'fr', 'Paracétamol 500 mg', 'manual', ${userIds[0] as string}, now())`;
  await sql`UPDATE catalog.products SET status = 'active' WHERE id = ${productId}`;
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO orders.orders (id, checkout_id, reference, locale, needs_review, total_cents, vat_cents,
        created_by_type, created_by_id, updated_by_type, updated_by_id)
      VALUES (${orderId}, ${checkoutId}, ${reference}, 'nl', true, 1250, 71,
        'anonymous', 'guest', 'anonymous', 'guest')`;
    await tx`
      INSERT INTO orders.order_lines (id, order_id, product_id, cnk, name, is_medicine, vat_class,
        quantity, unit_price_cents, line_total_cents, vat_cents)
      VALUES (${randomUUID()}, ${orderId}, ${productId}, ${cnk}, 'Paracetamol 500 mg', true, 'BE_6',
        1, 1250, 1250, 71)`;
    await tx`
      INSERT INTO orders.order_contacts (order_id, name, email, phone)
      VALUES (${orderId}, 'Demo Klant', 'demo@example.test', '+32470123456')`;
    await tx`
      INSERT INTO orders.payments (id, order_id, provider, amount_cents, status)
      VALUES (${randomUUID()}, ${orderId}, 'mollie', 1250, 'paid')`;
    const [lot] = await tx<{ id: string }[]>`
      INSERT INTO inventory.lots (id, product_id, location_id, tracking, lot_number, expiry_date,
        created_by_type, created_by_id)
      VALUES (gen_random_uuid(), ${productId}, ${LOCATION}, 'lot', 'E2E-ORD', '2099-12-31', 'system', 'e2e')
      RETURNING id`;
    const lotId = (lot as { id: string }).id;
    await tx`
      INSERT INTO inventory.stock_movements (id, product_id, location_id, lot_id, delta, reason, actor_type, actor_id)
      VALUES (gen_random_uuid(), ${productId}, ${LOCATION}, ${lotId}, 5, 'receipt', 'system', 'e2e')`;
    const [reservation] = await tx<{ id: string }[]>`
      INSERT INTO inventory.reservations (id, product_id, location_id, quantity, kind, holder_ref, status,
        created_by_type, created_by_id, updated_by_type, updated_by_id)
      VALUES (gen_random_uuid(), ${productId}, ${LOCATION}, 1, 'order', ${`checkout:${checkoutId}`},
        'active', 'system', 'checkout', 'system', 'checkout')
      RETURNING id`;
    await tx`
      INSERT INTO inventory.reservation_allocations (id, reservation_id, product_id, lot_id, quantity,
        created_by_type, created_by_id)
      VALUES (gen_random_uuid(), ${(reservation as { id: string }).id}, ${productId}, ${lotId}, 1,
        'system', 'checkout')`;
  });
  await sql`
    UPDATE orders.orders SET status = 'in_review', version = version + 1,
      updated_by_type = 'system', updated_by_id = 'payments', updated_at = now()
    WHERE id = ${orderId}`;
}

test.beforeAll(async () => {
  sql = postgres(smokeDatabaseUrl as string, { max: 1, ssl: "require", onnotice: () => {} });
  pharmacistToken = await staffMember("Pia Pharmacist", "pharmacist");
  assistantToken = await staffMember("Axel Assistant", "pharmacy_assistant");
  supportToken = await staffMember("Sam Support", "customer_service");
  await paidMedicineOrder();
});

test.afterAll(async () => {
  for (const id of userIds) await sql`DELETE FROM identity.users WHERE id = ${id}`;
  await sql?.end({ timeout: 5 });
});

test.describe.configure({ mode: "serial" });

test("customer service sees the review queue and the order, without actions", async ({
  page,
  context,
}) => {
  await signIn(context, supportToken);
  await page.goto(`${PLATFORM}/orders?status=in_review`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Orders", level: 1 })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: reference });
  await expect(row).toContainText("Pharmacist review");
  await expect(row).toContainText("Demo Klant");
  await expectAxeClean(page);

  await row.getByRole("link", { name: reference }).click();
  await expect(page.getByRole("heading", { name: reference, level: 1 })).toBeVisible();
  await expect(page.getByText("+32470123456")).toBeVisible();
  await expect(page.getByTestId("review-form")).toHaveCount(0);
  await expect(page.getByTestId("step-form")).toHaveCount(0);
  await expectAxeClean(page);
});

test("the pharmacist approves; the assistant prepares and marks it ready", async ({
  page,
  context,
}) => {
  await signIn(context, pharmacistToken);
  await page.goto(`${PLATFORM}/orders/${orderId}`, { waitUntil: "networkidle" });
  await page.getByLabel("Note (staff only, optional)").fill("Checked with the customer.");
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("The order is now “To prepare”.")).toBeVisible();
  await expect(page.getByTestId("review-record")).toContainText("Approved by you");

  await signIn(context, assistantToken);
  await page.goto(`${PLATFORM}/orders/${orderId}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Start preparing" }).click();
  await expect(page.getByText("The order is now “Preparing”.")).toBeVisible();
  // what to pick: the lot and its expiry (igs-pharma#165)
  const lots = page.getByTestId("lots-to-pick");
  await expect(lots).toContainText("E2E-ORD");
  await expect(lots).toContainText("Paracetamol 500 mg");
  await expect(page.getByTestId("allocation-short")).toHaveCount(0);
  await page.getByRole("button", { name: "Mark ready for pickup" }).click();
  await expect(page.getByText("The order is now “Ready for pickup”.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark collected" })).toBeVisible();
  await expectAxeClean(page);
});
