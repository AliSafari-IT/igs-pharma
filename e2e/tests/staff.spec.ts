import { createHmac, randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { type BrowserContext, type Page, expect, test } from "@playwright/test";
import postgres from "postgres";

import { smokeDatabaseUrl, smokeEnv } from "../smoke-env";

/**
 * igs-pharma#90: the Staff page against the production build. An owner whose own 2-step proof is
 * stale is asked to confirm first; with a fresh one, "Reset sign-in" deletes a staff member's
 * passkeys, signs them out, audits it and shows a new enrolment link once. That link leads to
 * "Set up 2-step login" with a passkey only. Needs SMOKE_DATABASE_URL (a migrated database).
 */
test.skip(!smokeDatabaseUrl, "set SMOKE_DATABASE_URL to a migrated database to run");

const PLATFORM = "http://localhost:3001";

let sql: postgres.Sql;
let ownerId: string;
let targetId: string;
let token: string;
const tag = randomUUID().slice(0, 8);
const targetName = `Lost Passkey ${tag}`;

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

async function staffUser(name: string, role: string) {
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO identity.users (id, name, email, email_verified, kind)
    VALUES (gen_random_uuid(), ${name}, ${`${randomUUID()}@example.test`}, true, 'staff')
    RETURNING id`;
  const id = (user as { id: string }).id;
  await sql`
    INSERT INTO identity.user_roles (id, user_id, role_key, location_id)
    VALUES (gen_random_uuid(), ${id}, ${role}, NULL)`;
  await sql`
    INSERT INTO identity.passkeys (id, user_id, public_key, credential_id, counter, device_type, backed_up)
    VALUES (gen_random_uuid(), ${id}, 'pk', ${randomUUID()}, 0, 'singleDevice', false)`;
  return id;
}

test.beforeAll(async () => {
  sql = postgres(smokeDatabaseUrl as string, { max: 1, ssl: "require", onnotice: () => {} });
  ownerId = await staffUser(`Staff Owner ${tag}`, "owner");
  targetId = await staffUser(targetName, "pharmacy_assistant");
  token = randomUUID();
  // the owner's session proved a second factor 20 minutes ago: verified, but not fresh
  await sql`
    INSERT INTO identity.sessions (id, user_id, token, expires_at, mfa_verified_at, passkey_checked_at)
    VALUES (gen_random_uuid(), ${ownerId}, ${token}, now() + interval '1 hour',
      now() - interval '20 minutes', now() - interval '20 minutes')`;
  await sql`
    INSERT INTO identity.sessions (id, user_id, token, expires_at, mfa_verified_at)
    VALUES (gen_random_uuid(), ${targetId}, ${randomUUID()}, now() + interval '1 hour', now())`;
});

test.afterAll(async () => {
  for (const id of [ownerId, targetId]) {
    if (!id) continue;
    await sql`DELETE FROM audit.events WHERE entity_id = ${id}`.catch(() => {});
    await sql`DELETE FROM identity.users WHERE id = ${id}`;
  }
  await sql?.end({ timeout: 5 });
});

test.describe.configure({ mode: "serial" });

test("signed out: the Staff page sends you to sign in", async ({ page }) => {
  await page.goto(`${PLATFORM}/staff`);
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("the owner sees staff and their sign-in methods; never a reset for themselves; axe clean", async ({
  page,
  context,
}) => {
  await signIn(context);
  await page.goto(`${PLATFORM}/staff`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Staff", level: 1 })).toBeVisible();
  const target = page.getByRole("row", { name: new RegExp(targetName) });
  await expect(target.getByText("1 passkey")).toBeVisible();
  await expect(target.getByRole("button", { name: "Reset sign-in" })).toBeVisible();
  const own = page.getByRole("row", { name: new RegExp(`Staff Owner ${tag}`) });
  await expect(own.getByRole("button", { name: "Reset sign-in" })).toHaveCount(0);
  // igs-pharma#112 V1: roles read as names, never as catalogue keys
  await expect(own.getByTestId("staff-role-badge")).toHaveText(["Owner"]);
  await expect(target.getByTestId("staff-role-badge")).toHaveText(["Pharmacy assistant"]);
  await expect(target.locator("code")).toHaveCount(0);
  // the Access picker shows names but still sends the keys
  const held = target.locator("option", { hasText: "Currently held: Pharmacy assistant" });
  await expect(held).toHaveAttribute("value", "pharmacy_assistant");
  const grant = target.locator("option", { hasText: "Grant: Titular pharmacist" });
  await expect(grant).toHaveAttribute("value", "pharmacist_titular");
  await expectAxeClean(page);
});

test("with a stale 2-step proof the owner must confirm first; nothing is reset", async ({
  page,
  context,
}) => {
  await signIn(context);
  await page.goto(`${PLATFORM}/staff`, { waitUntil: "networkidle" });
  await page
    .getByRole("row", { name: new RegExp(targetName) })
    .getByRole("button", { name: "Reset sign-in" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Reset sign-in" }).click();
  await expect(dialog.getByText("Confirm it's you first")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Confirm with your passkey" })).toBeVisible();
  const [left] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM identity.passkeys WHERE user_id = ${targetId}`;
  expect(left?.n).toBe(1);
});

test("with a fresh proof: the reset deletes their passkeys and sessions, is audited, and shows a link once", async ({
  page,
  context,
  browser,
}) => {
  // what a passkey confirmation does to the owner's session
  await sql`
    UPDATE identity.sessions SET mfa_verified_at = now(), passkey_checked_at = now()
    WHERE token = ${token}`;
  await signIn(context);
  await page.goto(`${PLATFORM}/staff`, { waitUntil: "networkidle" });
  await page
    .getByRole("row", { name: new RegExp(targetName) })
    .getByRole("button", { name: "Reset sign-in" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Reset sign-in" }).click();
  await expect(dialog.getByText("Sign-in reset")).toBeVisible();
  const link = (await dialog.locator("code").textContent()) ?? "";
  expect(link).toMatch(/^http:\/\/localhost:3001\/enrol#token=/);
  await expectAxeClean(page);

  const [state] = await sql<{ passkeys: number; sessions: number }[]>`
    SELECT (SELECT count(*)::int FROM identity.passkeys WHERE user_id = ${targetId}) AS passkeys,
           (SELECT count(*)::int FROM identity.sessions WHERE user_id = ${targetId}) AS sessions`;
  expect(state).toEqual({ passkeys: 0, sessions: 0 });
  const audit = await sql<{ action: string; actor_id: string; data: unknown }[]>`
    SELECT action, actor_id, data FROM audit.events WHERE entity_id = ${targetId} ORDER BY seq`;
  expect(audit).toEqual([
    { action: "identity.factors.reset", actor_id: ownerId, data: { userId: targetId } },
  ]);

  // the staff member opens the link and lands on "Set up 2-step login", with a passkey only
  const theirs = await browser.newContext();
  const theirPage = await theirs.newPage();
  await theirPage.goto(link);
  await theirPage.getByRole("button", { name: "Continue" }).click();
  await expect(theirPage).toHaveURL(`${PLATFORM}/setup`);
  await expect(theirPage.getByRole("button", { name: "Add a passkey" })).toBeVisible();
  await expect(theirPage.getByRole("button", { name: "Set up an authenticator app" })).toHaveCount(
    0,
  );
  await theirs.close();
});
