import { createHmac, randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { type BrowserContext, type Page, expect, test } from "@playwright/test";
import postgres from "postgres";

import { smokeDatabaseUrl, smokeEnv } from "../smoke-env";

/**
 * igs-pharma#199: early access to the closed webshop, end to end.
 *
 * The back-office part runs in the smoke job (production build): an owner approves, rejects and
 * revokes through the dialogs, a stale passkey check asks to confirm first, and each decision is
 * audited. The storefront part (ask → approved → the shop opens → revoked → coming-soon again) needs a
 * closed storefront built with customer accounts ON (`NEXT_PUBLIC_*` flags are fixed at build time,
 * and the smoke build keeps them off): point `SMOKE_EARLY_ACCESS_URL` at one to run it.
 */
test.skip(!smokeDatabaseUrl, "set SMOKE_DATABASE_URL to a migrated database to run");

const PLATFORM = "http://localhost:3001";
const STOREFRONT = process.env["SMOKE_EARLY_ACCESS_URL"];

let sql: postgres.Sql;
const tag = randomUUID().slice(0, 8);
const userIds: string[] = [];
let ownerId: string;
let ownerToken: string;

/** Better Auth's signed session cookie: `<token>.<base64 HMAC-SHA256>`, URI-encoded. */
const signed = (value: string) =>
  encodeURIComponent(
    `${value}.${createHmac("sha256", smokeEnv.AUTH_SECRET).update(value).digest("base64")}`,
  );

async function expectAxeClean(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

async function user(name: string, kind: "staff" | "customer", role: string) {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO identity.users (id, name, email, email_verified, kind)
    VALUES (gen_random_uuid(), ${name}, ${`${randomUUID()}@example.test`}, true, ${kind})
    RETURNING id`;
  const id = (row as { id: string }).id;
  userIds.push(id);
  await sql`
    INSERT INTO identity.user_roles (id, user_id, role_key, location_id)
    VALUES (gen_random_uuid(), ${id}, ${role}, NULL)`;
  return id;
}

/** A staff member without a sign-in factor is sent to set one up first: give them a passkey. */
async function passkey(userId: string) {
  await sql`
    INSERT INTO identity.passkeys (id, user_id, public_key, credential_id, counter, device_type, backed_up)
    VALUES (gen_random_uuid(), ${userId}, 'pk', ${randomUUID()}, 0, 'singleDevice', false)`;
}

async function session(userId: string, staff: boolean) {
  const token = randomUUID();
  if (staff) {
    await sql`
      INSERT INTO identity.sessions (id, user_id, token, expires_at, mfa_verified_at, passkey_checked_at)
      VALUES (gen_random_uuid(), ${userId}, ${token}, now() + interval '1 hour', now(), now())`;
  } else {
    await sql`
      INSERT INTO identity.sessions (id, user_id, token, expires_at)
      VALUES (gen_random_uuid(), ${userId}, ${token}, now() + interval '1 hour')`;
  }
  return token;
}

/** A customer with an open request, put there directly (the storefront part asks through the page). */
async function pendingCustomer(name: string) {
  const id = await user(name, "customer", "customer");
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO identity.early_access_requests (id, user_id, note)
    VALUES (gen_random_uuid(), ${id}, ${"I test for the pharmacy"}) RETURNING id`;
  return { userId: id, requestId: (row as { id: string }).id };
}

const statusOf = async (requestId: string) =>
  (
    await sql<{ status: string }[]>`
      SELECT status FROM identity.early_access_requests WHERE id = ${requestId}`
  )[0]?.status;

async function signInOwner(context: BrowserContext) {
  await context.addCookies([
    { name: "better-auth.session_token", value: signed(ownerToken), url: PLATFORM },
  ]);
}

/** Opens the dialog of `intent` on the row of `requestId` and confirms it. */
async function decide(page: Page, intent: "approve" | "reject" | "revoke", requestId: string) {
  await page.getByTestId(`early-access-${intent}-${requestId}`).click();
  const dialog = page.locator("dialog[open]");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  return dialog;
}

test.beforeAll(async () => {
  sql = postgres(smokeDatabaseUrl as string, {
    max: 1,
    ssl: process.env["SMOKE_DATABASE_SSL"] === "off" ? false : "require",
    onnotice: () => {},
  });
  ownerId = await user(`EA Owner ${tag}`, "staff", "owner");
  await passkey(ownerId);
  ownerToken = await session(ownerId, true);
});

test.afterAll(async () => {
  for (const id of userIds) {
    await sql`DELETE FROM identity.early_access_requests WHERE user_id = ${id}`.catch(() => {});
    await sql`DELETE FROM identity.mail_tokens WHERE user_id = ${id}`.catch(() => {});
    await sql`DELETE FROM identity.users WHERE id = ${id}`.catch(() => {});
  }
  await sql?.end();
});

test.describe.configure({ mode: "serial" });

test("the owner approves for 7 days, then revokes; both audited; the page is axe clean", async ({
  page,
  context,
}) => {
  const { userId, requestId } = await pendingCustomer(`EA Approve ${tag}`);
  await signInOwner(context);
  await page.goto(`${PLATFORM}/early-access`);
  await expect(page.getByRole("link", { name: "Early access" })).toBeVisible();
  await expect(page.getByTestId(`early-access-row-${requestId}`)).toContainText(
    "I test for the pharmacy",
  );
  await expectAxeClean(page);

  const dialog = await decide(page, "approve", requestId);
  await dialog.getByLabel("For how long").selectOption("7d");
  await dialog.getByTestId("early-access-submit-approve").click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(page.getByTestId("early-access-approved")).toContainText(`EA Approve ${tag}`);
  expect(await statusOf(requestId)).toBe("approved");
  const [grant] = await sql<{ days: number }[]>`
    SELECT round(extract(epoch FROM expires_at - decided_at) / 86400)::int AS days
    FROM identity.early_access_requests WHERE id = ${requestId}`;
  expect(grant?.days).toBe(7);

  const revoke = await decide(page, "revoke", requestId);
  await revoke.getByTestId("early-access-submit-revoke").click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  expect(await statusOf(requestId)).toBe("revoked");

  const audit = await sql<{ action: string; actor_id: string }[]>`
    SELECT action, actor_id FROM audit.events WHERE entity_id = ${requestId} ORDER BY seq`;
  expect(audit).toEqual([
    { action: "identity.early_access.approved", actor_id: ownerId },
    { action: "identity.early_access.revoked", actor_id: ownerId },
  ]);
  const mails = await sql<{ template: string }[]>`
    SELECT template FROM identity.mail_tokens WHERE user_id = ${userId} ORDER BY template`;
  expect(mails.map((m) => m.template)).toEqual(["early_access_approved", "early_access_revoked"]);
});

test("Cancel decides nothing; a stale passkey check asks to confirm first and decides nothing", async ({
  page,
  context,
}) => {
  const { requestId } = await pendingCustomer(`EA Reject ${tag}`);
  await signInOwner(context);
  await page.goto(`${PLATFORM}/early-access`);

  const first = await decide(page, "reject", requestId);
  await first.getByRole("button", { name: "Cancel" }).click();
  expect(await statusOf(requestId)).toBe("pending");

  await sql`
    UPDATE identity.sessions SET passkey_checked_at = now() - interval '20 minutes'
    WHERE user_id = ${ownerId}`;
  const stale = await decide(page, "reject", requestId);
  await stale.getByLabel(/Reason/).fill("Testers only for now");
  await stale.getByTestId("early-access-submit-reject").click();
  await expect(stale.getByText("Confirm it's you first")).toBeVisible();
  await expect(stale.getByRole("button", { name: "Confirm with your passkey" })).toBeVisible();
  expect(await statusOf(requestId)).toBe("pending");
  await sql`UPDATE identity.sessions SET passkey_checked_at = now() WHERE user_id = ${ownerId}`;
});

test("staff without the permission cannot see or decide early access", async ({
  page,
  context,
}) => {
  const titular = await user(`EA Titular ${tag}`, "staff", "pharmacist_titular");
  await passkey(titular);
  await context.addCookies([
    {
      name: "better-auth.session_token",
      value: signed(await session(titular, true)),
      url: PLATFORM,
    },
  ]);
  await page.goto(`${PLATFORM}/early-access`);
  await expect(page.getByText("You can't see early access")).toBeVisible();
  await expect(page.getByRole("link", { name: "Early access" })).toHaveCount(0);
});

test.describe("the storefront side (needs SMOKE_EARLY_ACCESS_URL)", () => {
  test.skip(
    !STOREFRONT,
    "set SMOKE_EARLY_ACCESS_URL to a closed storefront built with accounts on",
  );

  test("ask → approved → the shop opens → revoked → coming-soon again", async ({ browser }) => {
    const shop = STOREFRONT as string;
    const customerId = await user(`EA Shopper ${tag}`, "customer", "customer");
    const customer = await browser.newContext();
    await customer.addCookies([
      { name: "igs-c.session_token", value: signed(await session(customerId, false)), url: shop },
    ]);
    const page = await customer.newPage();

    // closed for them, no redirect, no hint beyond the coming-soon link
    await page.goto(`${shop}/nl`);
    await expect(page.getByText("Binnenkort open")).toBeVisible();
    await page.getByTestId("early-access-link-nl").click();
    await expect(page.getByTestId("gate-shell")).toBeVisible();
    await page.getByLabel(/Een bericht voor de apotheek/).fill("Ik test de winkel");
    await page.getByTestId("early-access-submit").click();
    await expect(page.getByTestId("early-access-result-requested")).toBeVisible();
    await expectAxeClean(page);
    const [request] = await sql<{ id: string }[]>`
      SELECT id FROM identity.early_access_requests WHERE user_id = ${customerId}`;
    const requestId = (request as { id: string }).id;

    // the owner approves in the back-office
    const owner = await browser.newContext();
    await owner.addCookies([
      { name: "better-auth.session_token", value: signed(ownerToken), url: PLATFORM },
    ]);
    const back = await owner.newPage();
    await back.goto(`${PLATFORM}/early-access`);
    const approve = await decide(back, "approve", requestId);
    await approve.getByTestId("early-access-submit-approve").click();
    await expect(back.locator("dialog[open]")).toHaveCount(0);

    // the shop opens, with the banner
    await page.goto(`${shop}/nl/early-access`);
    await page.getByRole("link", { name: "Naar de webwinkel" }).click();
    await expect(page.getByTestId("early-access-banner")).toBeVisible();
    await expect(page.getByTestId("shell")).toBeVisible();

    // revoked: the next pass check refuses, the pass is cleared, the shop is closed again
    const revoke = await decide(back, "revoke", requestId);
    await revoke.getByTestId("early-access-submit-revoke").click();
    await expect(back.locator("dialog[open]")).toHaveCount(0);
    await page.goto(`${shop}/api/early-access/pass?next=/nl`);
    await expect(page.getByTestId("early-access-result-passRefused")).toBeVisible();
    await page.goto(`${shop}/nl`);
    await expect(page.getByText("Binnenkort open")).toBeVisible();
    expect((await customer.cookies()).some((c) => c.name === "igs_early_access")).toBe(false);
    await customer.close();
    await owner.close();
  });
});
