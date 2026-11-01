import { createHmac, randomInt, randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { type BrowserContext, type Page, expect, test } from "@playwright/test";
import postgres from "postgres";

import { smokeDatabaseUrl, smokeEnv } from "../smoke-env";

/**
 * igs-pharma#202 (part 3): a home-delivery order in the back-office: pack it (the label is asked
 * for), the label arrives (the worker's part, done here in SQL: no Sendcloud in CI), print it, hand
 * it to the carrier, and record the parcel that came back.
 */
test.skip(!smokeDatabaseUrl, "set SMOKE_DATABASE_URL to a migrated database to run");

const PLATFORM = "http://localhost:3001";

let sql: postgres.Sql;
const userIds: string[] = [];
let assistantToken: string;
let orderId: string;

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
const uuidv7 = () => `0192f000-0000-7000-8000-${randomUUID().replaceAll("-", "").slice(0, 12)}`;

/**
 * A paid guest order for one plaster, delivered at home (fee 4.95 included), ready to prepare: its
 * stock set aside and allocated to a lot the way a payment leaves it.
 */
async function paidDeliveryOrder(): Promise<void> {
  orderId = randomUUID();
  const checkoutId = uuidv7();
  const reference = `IGS-2026-${String(randomInt(900_000, 999_999))}`;
  const cnk = `97${String(randomInt(0, 100_000)).padStart(5, "0")}`;
  const [product] = await sql<{ id: string }[]>`
    INSERT INTO catalog.products (id, cnk, product_type, legal_status, vat_class, status)
    VALUES (gen_random_uuid(), ${cnk}, 'medical_device', 'general_sale', 'BE_21', 'draft')
    RETURNING id`;
  const productId = (product as { id: string }).id;
  await sql`
    INSERT INTO catalog.product_content (product_id, locale, name, source, approved_by, approved_at)
    VALUES (${productId}, 'nl', 'Pleisters', 'manual', ${userIds[0] as string}, now()),
      (${productId}, 'fr', 'Pansements', 'manual', ${userIds[0] as string}, now())`;
  await sql`UPDATE catalog.products SET status = 'active' WHERE id = ${productId}`;
  await sql.begin(async (tx) => {
    // 1000 for the line (VAT 174) + 495 delivery (VAT 86)
    await tx`
      INSERT INTO orders.orders (id, checkout_id, reference, locale, needs_review, total_cents, vat_cents,
        delivery_method, delivery_fee_cents, delivery_vat_cents,
        created_by_type, created_by_id, updated_by_type, updated_by_id)
      VALUES (${orderId}, ${checkoutId}, ${reference}, 'nl', false, 1495, 260, 'delivery', 495, 86,
        'anonymous', 'guest', 'anonymous', 'guest')`;
    await tx`
      INSERT INTO orders.order_lines (id, order_id, product_id, cnk, name, is_medicine, vat_class,
        quantity, unit_price_cents, line_total_cents, vat_cents)
      VALUES (${randomUUID()}, ${orderId}, ${productId}, ${cnk}, 'Pleisters', false, 'BE_21',
        1, 1000, 1000, 174)`;
    await tx`
      INSERT INTO orders.order_addresses (order_id, street, postal_code, city)
      VALUES (${orderId}, 'Demostraat 12 bus 3', '1000', 'Brussel')`;
    await tx`
      INSERT INTO orders.order_contacts (order_id, name, email, phone)
      VALUES (${orderId}, 'Demo Klant', 'demo@example.test', '+32470123456')`;
    await tx`
      INSERT INTO orders.payments (id, order_id, provider, amount_cents, status)
      VALUES (${randomUUID()}, ${orderId}, 'mollie', 1495, 'paid')`;
    const [lot] = await tx<{ id: string }[]>`
      INSERT INTO inventory.lots (id, product_id, location_id, tracking, lot_number, expiry_date,
        created_by_type, created_by_id)
      VALUES (gen_random_uuid(), ${productId}, ${LOCATION}, 'lot', 'E2E-SHIP', '2099-12-31', 'system', 'e2e')
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
    UPDATE orders.orders SET status = 'ready_to_prepare', version = version + 1,
      updated_by_type = 'system', updated_by_id = 'payments', updated_at = now()
    WHERE id = ${orderId}`;
}

test.beforeAll(async () => {
  sql = postgres(smokeDatabaseUrl as string, { max: 1, ssl: "require", onnotice: () => {} });
  assistantToken = await staffMember("Axel Assistant", "pharmacy_assistant");
  await paidDeliveryOrder();
});

test.afterAll(async () => {
  for (const id of userIds) await sql`DELETE FROM identity.users WHERE id = ${id}`;
  await sql?.end({ timeout: 5 });
});

test.describe.configure({ mode: "serial" });

test("pack: the label is asked for; nothing can be handed over without it", async ({
  page,
  context,
}) => {
  await signIn(context, assistantToken);
  await page.goto(`${PLATFORM}/orders/${orderId}`, { waitUntil: "networkidle" });
  await expect(page.getByTestId("staff-order-method")).toHaveText("Home delivery");
  await page.getByRole("button", { name: "Start preparing" }).click();
  await expect(page.getByText("The order is now “Preparing”.")).toBeVisible();
  // a delivery order is packed, never "ready for pickup"
  await expect(page.getByRole("button", { name: "Mark ready for pickup" })).toHaveCount(0);
  await page.getByRole("button", { name: "Packed: make the label" }).click();
  await expect(page.getByText("The order is now “Packed, to hand over”.")).toBeVisible();
  await expect(page.getByTestId("shipment")).toContainText("Label being made");
  await expect(page.getByRole("button", { name: "Handed to the carrier" })).toHaveCount(0);
  await expectAxeClean(page);
});

test("the label arrives: print it, hand the parcel over, record it came back", async ({
  page,
  context,
}) => {
  // what the worker records once Sendcloud made the label
  await sql`
    UPDATE orders.shipments SET status = 'created', provider_parcel_id = '424242',
      tracking_number = '323211588764200', tracking_url = 'https://tracking.example/323211588764200',
      carrier = 'bpost', label_created_at = now(), version = version + 1, updated_at = now()
    WHERE order_id = ${orderId}`;
  await signIn(context, assistantToken);
  await page.goto(`${PLATFORM}/orders/${orderId}`, { waitUntil: "networkidle" });
  const shipment = page.getByTestId("shipment");
  await expect(shipment).toContainText("Label ready");
  await expect(shipment).toContainText("323211588764200");
  await expect(page.getByTestId("label-a4")).toHaveAttribute("href", `/orders/${orderId}/label`);

  await page.getByRole("button", { name: "Handed to the carrier" }).click();
  await expect(page.getByText("The order is now “With the carrier”.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark delivered" })).toBeVisible();
  await page.getByRole("button", { name: "Parcel came back" }).click();
  await expect(page.getByText("The order is now “Parcel returned”.")).toBeVisible();
  await expect(page.getByTestId("step-form")).toHaveCount(0);
  await expectAxeClean(page);

  const [mail] = await sql<{ kind: string }[]>`
    SELECT kind FROM orders.order_mails WHERE order_id = ${orderId} AND kind = 'shipped'`;
  expect(mail?.kind).toBe("shipped");
});
