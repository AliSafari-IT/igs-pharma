import { createHmac, randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { type BrowserContext, type Page, expect, test } from "@playwright/test";
import postgres from "postgres";

import { smokeDatabaseUrl, smokeEnv } from "../smoke-env";

/**
 * igs-pharma#202, part 1: the Delivery page of the back-office against the production build. Until
 * staff save something the page shows the placeholder defaults and says so; with a stale passkey
 * check the owner is asked to confirm and nothing is saved; with a fresh one a price and a
 * free-delivery value are saved (or "never free" when it is empty), audited with amounts only; and a
 * pharmacist who is not the titular cannot see the page. Needs SMOKE_DATABASE_URL (a migrated database).
 */
test.skip(!smokeDatabaseUrl, "set SMOKE_DATABASE_URL to a migrated database to run");

const PLATFORM = "http://localhost:3001";

let sql: postgres.Sql;
let ownerId: string;
let pharmacistId: string;
let ownerToken: string;
let pharmacistToken: string;
const tag = randomUUID().slice(0, 8);
const userIds: string[] = [];

/** Better Auth's signed session cookie: `<token>.<base64 HMAC-SHA256>`, URI-encoded (better-call). */
const signed = (value: string) =>
  encodeURIComponent(
    `${value}.${createHmac("sha256", smokeEnv.AUTH_SECRET).update(value).digest("base64")}`,
  );

async function signIn(context: BrowserContext, token: string) {
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

/** A staff member with a role, a passkey and a session; `checkedMinutesAgo` is the last passkey check. */
async function staff(name: string, role: string, checkedMinutesAgo: number) {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO identity.users (id, name, email, email_verified, kind)
    VALUES (gen_random_uuid(), ${name}, ${`${randomUUID()}@example.test`}, true, 'staff')
    RETURNING id`;
  const id = (row as { id: string }).id;
  userIds.push(id);
  await sql`
    INSERT INTO identity.user_roles (id, user_id, role_key, location_id)
    VALUES (gen_random_uuid(), ${id}, ${role}, NULL)`;
  await sql`
    INSERT INTO identity.passkeys (id, user_id, public_key, credential_id, counter, device_type, backed_up)
    VALUES (gen_random_uuid(), ${id}, 'pk', ${randomUUID()}, 0, 'singleDevice', false)`;
  const token = randomUUID();
  await sql`
    INSERT INTO identity.sessions (id, user_id, token, expires_at, mfa_verified_at, passkey_checked_at)
    VALUES (gen_random_uuid(), ${id}, ${token}, now() + interval '1 hour',
      now() - ${checkedMinutesAgo} * interval '1 minute', now() - ${checkedMinutesAgo} * interval '1 minute')`;
  return { id, token };
}

const stored = () =>
  sql<{ price_cents: number; free_from_cents: number | null; version: number }[]>`
    SELECT price_cents, free_from_cents, version FROM orders.delivery_settings`;

test.beforeAll(async () => {
  sql = postgres(smokeDatabaseUrl as string, { max: 1, ssl: "require", onnotice: () => {} });
  await sql`DELETE FROM orders.delivery_settings`;
  // the owner's last passkey check was 20 minutes ago: verified, but not fresh
  const owner = await staff(`Delivery Owner ${tag}`, "owner", 20);
  ownerId = owner.id;
  ownerToken = owner.token;
  const pharmacist = await staff(`Delivery Pharmacist ${tag}`, "pharmacist", 1);
  pharmacistId = pharmacist.id;
  pharmacistToken = pharmacist.token;
});

test.afterAll(async () => {
  await sql`DELETE FROM orders.delivery_settings`.catch(() => {});
  await sql`DELETE FROM audit.events WHERE action = 'orders.delivery_settings.set' AND actor_id = ${ownerId}`.catch(
    () => {},
  );
  for (const id of userIds) await sql`DELETE FROM identity.users WHERE id = ${id}`.catch(() => {});
  await sql?.end({ timeout: 5 });
});

test.describe.configure({ mode: "serial" });

test("signed out: the Delivery page sends you to sign in", async ({ page }) => {
  await page.goto(`${PLATFORM}/settings/delivery`);
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("the owner sees the placeholder defaults, marked as defaults; axe clean", async ({
  page,
  context,
}) => {
  await signIn(context, ownerToken);
  await page.goto(`${PLATFORM}/settings/delivery`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Delivery", level: 1 })).toBeVisible();
  await expect(page.getByTestId("delivery-default-note")).toBeVisible();
  await expect(page.getByLabel(/Delivery price/)).toHaveValue("4.95");
  await expect(page.getByLabel(/Free delivery from/)).toHaveValue("49.00");
  // the menu lists it for the owner
  await expect(page.getByRole("link", { name: "Delivery" }).first()).toBeVisible();
  await expectAxeClean(page);
});

test("with a stale passkey check the owner must confirm first; nothing is saved", async ({
  page,
  context,
}) => {
  await signIn(context, ownerToken);
  await page.goto(`${PLATFORM}/settings/delivery`, { waitUntil: "networkidle" });
  await page.getByLabel(/Delivery price/).fill("5,95");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Confirm it's you first")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm with your passkey" })).toBeVisible();
  expect(await stored()).toEqual([]);
});

test("an invalid amount is refused with a reason, even before the passkey check", async ({
  page,
  context,
}) => {
  await signIn(context, ownerToken);
  await page.goto(`${PLATFORM}/settings/delivery`, { waitUntil: "networkidle" });
  await page.getByLabel(/Delivery price/).fill("4,955");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/delivery price must be an amount from 0 to 50.00/)).toBeVisible();
  await page.getByLabel(/Delivery price/).fill("60");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/delivery price must be an amount from 0 to 50.00/)).toBeVisible();
  expect(await stored()).toEqual([]);
});

test("with a fresh check: saves a price and 'never free', audited with amounts only", async ({
  page,
  context,
}) => {
  // what a passkey confirmation does to the owner's session
  await sql`
    UPDATE identity.sessions SET mfa_verified_at = now(), passkey_checked_at = now()
    WHERE token = ${ownerToken}`;
  await signIn(context, ownerToken);
  await page.goto(`${PLATFORM}/settings/delivery`, { waitUntil: "networkidle" });
  await page.getByLabel(/Delivery price/).fill("5,95");
  await page.getByLabel(/Free delivery from/).fill("");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("New orders use these amounts straight away.")).toBeVisible();
  expect(await stored()).toEqual([{ price_cents: 595, free_from_cents: null, version: 1 }]);

  // the next load reads the new values, no longer the defaults
  await page.goto(`${PLATFORM}/settings/delivery`, { waitUntil: "networkidle" });
  await expect(page.getByTestId("delivery-default-note")).toHaveCount(0);
  await expect(page.getByTestId("delivery-updated")).toBeVisible();
  await expect(page.getByLabel(/Delivery price/)).toHaveValue("5.95");
  await expect(page.getByLabel(/Free delivery from/)).toHaveValue("");
  await expectAxeClean(page);

  // and a free-delivery value again
  await page.getByLabel(/Free delivery from/).fill("60.00");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("New orders use these amounts straight away.")).toBeVisible();
  expect(await stored()).toEqual([{ price_cents: 595, free_from_cents: 6000, version: 2 }]);

  const events = await sql<{ action: string; actor_id: string; data: Record<string, unknown> }[]>`
    SELECT action, actor_id, data FROM audit.events
    WHERE action = 'orders.delivery_settings.set' AND actor_id = ${ownerId} ORDER BY seq`;
  expect(events).toEqual([
    {
      action: "orders.delivery_settings.set",
      actor_id: ownerId,
      data: {
        priceCents: 595,
        freeFromCents: null,
        previousPriceCents: null,
        previousFreeFromCents: null,
        version: 1,
      },
    },
    {
      action: "orders.delivery_settings.set",
      actor_id: ownerId,
      data: {
        priceCents: 595,
        freeFromCents: 6000,
        previousPriceCents: 595,
        previousFreeFromCents: null,
        version: 2,
      },
    },
  ]);
});

test("a pharmacist who is not the titular cannot see or change it", async ({ page, context }) => {
  expect(pharmacistId).toBeTruthy();
  await signIn(context, pharmacistToken);
  await page.goto(`${PLATFORM}/settings/delivery`, { waitUntil: "networkidle" });
  await expect(page.getByText("You can't see the delivery settings")).toBeVisible();
  await expect(page.getByTestId("delivery-form")).toHaveCount(0);
  // and the menu does not list it
  await expect(page.getByRole("link", { name: "Delivery" })).toHaveCount(0);
});
