import { createHmac, randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { type BrowserContext, type Page, expect, test } from "@playwright/test";
import postgres from "postgres";

import { smokeDatabaseUrl, smokeEnv } from "../smoke-env";

/**
 * igs-pharma#199, part 3: the Early access page of the back-office against the production build.
 * An owner whose passkey check is stale is asked to confirm first and nothing is decided; with a
 * fresh one they approve (for 90 days), reject (with a reason) and revoke, every decision is audited,
 * and their own request offers no buttons. The storefront half (request, pass, denied after a revoke)
 * needs a web build with the customer accounts flag, which the smoke build does not have: it is
 * covered by the web tests. Needs SMOKE_DATABASE_URL (a migrated database).
 */
test.skip(!smokeDatabaseUrl, "set SMOKE_DATABASE_URL to a migrated database to run");

const PLATFORM = "http://localhost:3001";

let sql: postgres.Sql;
let ownerId: string;
let token: string;
const tag = randomUUID().slice(0, 8);
const approveName = `Approve Me ${tag}`;
const rejectName = `Reject Me ${tag}`;
const ownName = `Staff Owner ${tag}`;
const userIds: string[] = [];
const requestIds: Record<string, string> = {};

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

async function user(name: string, kind: "staff" | "customer") {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO identity.users (id, name, email, email_verified, kind)
    VALUES (gen_random_uuid(), ${name}, ${`${randomUUID()}@example.test`}, true, ${kind})
    RETURNING id`;
  const id = (row as { id: string }).id;
  userIds.push(id);
  return id;
}

async function pendingRequest(userId: string, note: string) {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO identity.early_access_requests (id, user_id, status, note)
    VALUES (gen_random_uuid(), ${userId}, 'pending', ${note})
    RETURNING id`;
  return (row as { id: string }).id;
}

const audit = (requestId: string) => sql<{ action: string; actor_id: string }[]>`
  SELECT action, actor_id FROM audit.events WHERE entity_id = ${requestId} ORDER BY seq`;

test.beforeAll(async () => {
  sql = postgres(smokeDatabaseUrl as string, { max: 1, ssl: "require", onnotice: () => {} });
  ownerId = await user(ownName, "staff");
  await sql`
    INSERT INTO identity.user_roles (id, user_id, role_key, location_id)
    VALUES (gen_random_uuid(), ${ownerId}, 'owner', NULL)`;
  await sql`
    INSERT INTO identity.passkeys (id, user_id, public_key, credential_id, counter, device_type, backed_up)
    VALUES (gen_random_uuid(), ${ownerId}, 'pk', ${randomUUID()}, 0, 'singleDevice', false)`;
  token = randomUUID();
  // the owner's session proved a second factor 20 minutes ago: verified, but not fresh
  await sql`
    INSERT INTO identity.sessions (id, user_id, token, expires_at, mfa_verified_at, passkey_checked_at)
    VALUES (gen_random_uuid(), ${ownerId}, ${token}, now() + interval '1 hour',
      now() - interval '20 minutes', now() - interval '20 minutes')`;
  requestIds["approve"] = await pendingRequest(
    await user(approveName, "customer"),
    "Pharmacist friend",
  );
  requestIds["reject"] = await pendingRequest(await user(rejectName, "customer"), "Just curious");
  requestIds["own"] = await pendingRequest(ownerId, "My own test");
});

test.afterAll(async () => {
  for (const requestId of Object.values(requestIds)) {
    await sql`DELETE FROM audit.events WHERE entity_id = ${requestId}`.catch(() => {});
  }
  for (const id of userIds) {
    await sql`DELETE FROM identity.users WHERE id = ${id}`.catch(() => {});
  }
  await sql?.end({ timeout: 5 });
});

test.describe.configure({ mode: "serial" });

test("signed out: the Early access page sends you to sign in", async ({ page }) => {
  await page.goto(`${PLATFORM}/early-access`);
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("the owner sees who is waiting; their own request has no buttons; axe clean", async ({
  page,
  context,
}) => {
  await signIn(context);
  await page.goto(`${PLATFORM}/early-access`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Early access", level: 1 })).toBeVisible();
  await expect(page.getByText("within 15 minutes")).toBeVisible();
  const pending = page.getByTestId("early-access-pending");
  const target = pending.getByRole("row", { name: new RegExp(approveName) });
  await expect(target.getByText("Pharmacist friend")).toBeVisible();
  await expect(target.getByRole("button", { name: "Approve" })).toBeVisible();
  await expect(target.getByRole("button", { name: "Reject" })).toBeVisible();
  const own = pending.getByRole("row", { name: new RegExp(ownName) });
  await expect(own.getByRole("button")).toHaveCount(0);
  await expect(own.getByText("another owner decides")).toBeVisible();
  await expectAxeClean(page);
});

test("with a stale passkey check the owner must confirm first; nothing is decided", async ({
  page,
  context,
}) => {
  await signIn(context);
  await page.goto(`${PLATFORM}/early-access`, { waitUntil: "networkidle" });
  await page
    .getByRole("row", { name: new RegExp(approveName) })
    .getByRole("button", { name: "Approve" })
    .click();
  const dialog = page.getByRole("dialog");
  // Cancel has the focus, so a stray Enter decides nothing
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await dialog.getByRole("button", { name: "Give access" }).click();
  await expect(dialog.getByText("Confirm it's you first")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Confirm with your passkey" })).toBeVisible();
  const [row] = await sql<{ status: string }[]>`
    SELECT status FROM identity.early_access_requests WHERE id = ${requestIds["approve"] as string}`;
  expect(row?.status).toBe("pending");
});

test("with a fresh check: approve for 90 days, reject with a reason, then revoke; all audited", async ({
  page,
  context,
}) => {
  // what a passkey confirmation does to the owner's session
  await sql`
    UPDATE identity.sessions SET mfa_verified_at = now(), passkey_checked_at = now()
    WHERE token = ${token}`;
  await signIn(context);
  await page.goto(`${PLATFORM}/early-access`, { waitUntil: "networkidle" });

  // approve
  await page
    .getByRole("row", { name: new RegExp(approveName) })
    .getByRole("button", { name: "Approve" })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Access lasts").selectOption("90d");
  await dialog.getByRole("button", { name: "Give access" }).click();
  const active = page.getByTestId("early-access-active");
  await expect(active.getByRole("row", { name: new RegExp(approveName) })).toBeVisible();
  const [approved] = await sql<{ status: string; days: number; decided_by: string }[]>`
    SELECT status, round(extract(epoch FROM expires_at - now()) / 86400)::int AS days, decided_by
    FROM identity.early_access_requests WHERE id = ${requestIds["approve"] as string}`;
  expect(approved).toEqual({ status: "approved", days: 90, decided_by: ownerId });
  await expectAxeClean(page);

  // reject, with a reason
  await page
    .getByRole("row", { name: new RegExp(rejectName) })
    .getByRole("button", { name: "Reject" })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Reason (optional)").fill("Not this round");
  await dialog.getByRole("button", { name: "Reject request" }).click();
  const history = page.getByTestId("early-access-history");
  const rejected = history.getByRole("row", { name: new RegExp(rejectName) });
  await expect(rejected.getByText("rejected")).toBeVisible();
  await expect(rejected.getByText("Not this round")).toBeVisible();

  // revoke the first one
  await active
    .getByRole("row", { name: new RegExp(approveName) })
    .getByRole("button", { name: "Revoke" })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "End access" }).click();
  await expect(history.getByRole("row", { name: new RegExp(approveName) })).toBeVisible();
  await expect(active.getByRole("row", { name: new RegExp(approveName) })).toHaveCount(0);

  const states = await sql<{ id: string; status: string }[]>`
    SELECT id, status FROM identity.early_access_requests
    WHERE id IN (${requestIds["approve"] as string}, ${requestIds["reject"] as string})`;
  expect(Object.fromEntries(states.map((s) => [s.id, s.status]))).toEqual({
    [requestIds["approve"] as string]: "revoked",
    [requestIds["reject"] as string]: "rejected",
  });
  expect(await audit(requestIds["approve"] as string)).toEqual([
    { action: "identity.early_access.approved", actor_id: ownerId },
    { action: "identity.early_access.revoked", actor_id: ownerId },
  ]);
  expect(await audit(requestIds["reject"] as string)).toEqual([
    { action: "identity.early_access.rejected", actor_id: ownerId },
  ]);
  // the reason is shown on the page but never written to the audit trail (D-028)
  const [leak] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM audit.events
    WHERE entity_id = ${requestIds["reject"] as string} AND data::text LIKE '%Not this round%'`;
  expect(leak?.n).toBe(0);
});

/** A staff member with a role, a passkey and a session whose passkey check is from just now. */
async function freshStaff(name: string, role: string): Promise<string> {
  const id = await user(name, "staff");
  await sql`
    INSERT INTO identity.user_roles (id, user_id, role_key, location_id)
    VALUES (gen_random_uuid(), ${id}, ${role}, NULL)`;
  await sql`
    INSERT INTO identity.passkeys (id, user_id, public_key, credential_id, counter, device_type, backed_up)
    VALUES (gen_random_uuid(), ${id}, 'pk', ${randomUUID()}, 0, 'singleDevice', false)`;
  const sessionToken = randomUUID();
  await sql`
    INSERT INTO identity.sessions (id, user_id, token, expires_at, mfa_verified_at, passkey_checked_at)
    VALUES (gen_random_uuid(), ${id}, ${sessionToken}, now() + interval '1 hour', now(), now())`;
  return sessionToken;
}

const statusOf = async (requestId: string) =>
  (
    await sql<{ status: string }[]>`
      SELECT status FROM identity.early_access_requests WHERE id = ${requestId}`
  )[0]?.status;

test("Cancel decides nothing; an approval and a revoke each queue the customer's mail", async ({
  page,
  context,
}) => {
  const name = `Mail Me ${tag}`;
  const customerId = await user(name, "customer");
  const requestId = await pendingRequest(customerId, "Mail test");
  requestIds["mail"] = requestId;
  await signIn(context);
  await page.goto(`${PLATFORM}/early-access`, { waitUntil: "networkidle" });
  const waiting = page.getByTestId("early-access-pending").getByRole("row", { name });

  await waiting.getByRole("button", { name: "Reject" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  expect(await statusOf(requestId)).toBe("pending");

  await waiting.getByRole("button", { name: "Approve" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Give access" }).click();
  const active = page.getByTestId("early-access-active").getByRole("row", { name });
  await expect(active).toBeVisible();
  await active.getByRole("button", { name: "Revoke" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "End access" }).click();
  await expect(page.getByTestId("early-access-history").getByRole("row", { name })).toBeVisible();

  // the web request never talks to a mail server: each decision only queued its mail (D-019)
  const mails = await sql<{ template: string }[]>`
    SELECT template FROM identity.mail_tokens WHERE user_id = ${customerId} ORDER BY template`;
  expect(mails.map((mail) => mail.template)).toEqual([
    "early_access_approved",
    "early_access_revoked",
  ]);
});

test("staff without the permission cannot see or decide early access", async ({
  page,
  context,
}) => {
  const titularToken = await freshStaff(`Titular ${tag}`, "pharmacist_titular");
  await context.addCookies([
    { name: "better-auth.session_token", value: signed(titularToken), url: PLATFORM },
  ]);
  await page.goto(`${PLATFORM}/early-access`, { waitUntil: "networkidle" });
  await expect(page.getByText("You can't see the early-access requests")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Early access" })).toHaveCount(0);
});

/**
 * The storefront half (igs-pharma#199's acceptance test): needs a CLOSED storefront built with
 * customer accounts ON. `NEXT_PUBLIC_*` flags are fixed at build time and the smoke build keeps them
 * off (`customer-accounts.spec.ts` asserts that), so this runs against one you start yourself:
 * `SMOKE_EARLY_ACCESS_URL=http://localhost:3002 pnpm exec playwright test early-access`.
 * The smoke config leaves it out by its tag (`grepInvert`), as the smoke run fails on any skipped test.
 */
const STOREFRONT = process.env["SMOKE_EARLY_ACCESS_URL"];

test.describe("the storefront side (needs SMOKE_EARLY_ACCESS_URL) @early-access-storefront", () => {
  test.skip(
    !STOREFRONT,
    "set SMOKE_EARLY_ACCESS_URL to a closed storefront built with accounts on",
  );

  test("ask → approved → the shop opens → revoked → coming-soon again", async ({ browser }) => {
    const shop = STOREFRONT as string;
    const name = `Shopper ${tag}`;
    const customerId = await user(name, "customer");
    // a customer may ask for, read and use their own early access through the `customer` role
    await sql`
      INSERT INTO identity.user_roles (id, user_id, role_key, location_id)
      VALUES (gen_random_uuid(), ${customerId}, 'customer', NULL)`;
    const customerToken = randomUUID();
    await sql`
      INSERT INTO identity.sessions (id, user_id, token, expires_at)
      VALUES (gen_random_uuid(), ${customerId}, ${customerToken}, now() + interval '1 hour')`;
    const customer = await browser.newContext();
    await customer.addCookies([
      { name: "igs-c.session_token", value: signed(customerToken), url: shop },
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
    requestIds["shopper"] = requestId;

    // the owner approves in the back-office
    const owner = await browser.newContext();
    await owner.addCookies([
      { name: "better-auth.session_token", value: signed(token), url: PLATFORM },
    ]);
    const back = await owner.newPage();
    await back.goto(`${PLATFORM}/early-access`, { waitUntil: "networkidle" });
    await back
      .getByTestId("early-access-pending")
      .getByRole("row", { name })
      .getByRole("button", { name: "Approve" })
      .click();
    await back.getByRole("dialog").getByRole("button", { name: "Give access" }).click();
    await expect(back.getByTestId("early-access-active").getByRole("row", { name })).toBeVisible();

    // the shop opens, with the banner
    await page.goto(`${shop}/nl/early-access`);
    await page.getByRole("link", { name: "Naar de webwinkel" }).click();
    await expect(page.getByTestId("early-access-banner")).toBeVisible();
    await expect(page.getByTestId("shell")).toBeVisible();

    // revoked: the next pass check refuses, the pass is cleared, the shop is closed again
    await back
      .getByTestId("early-access-active")
      .getByRole("row", { name })
      .getByRole("button", { name: "Revoke" })
      .click();
    await back.getByRole("dialog").getByRole("button", { name: "End access" }).click();
    await expect(back.getByTestId("early-access-history").getByRole("row", { name })).toBeVisible();
    // an address of its own: the pass route's per-address limit must not carry over between runs
    await customer.setExtraHTTPHeaders({ "x-forwarded-for": `198.51.100.${Date.now() % 250}` });
    await page.goto(`${shop}/api/early-access/pass?next=/nl`);
    await expect(page.getByTestId("early-access-result-passRefused")).toBeVisible();
    await page.goto(`${shop}/nl`);
    await expect(page.getByText("Binnenkort open")).toBeVisible();
    expect((await customer.cookies()).some((cookie) => cookie.name === "igs_early_access")).toBe(
      false,
    );
    await customer.close();
    await owner.close();
  });
});
