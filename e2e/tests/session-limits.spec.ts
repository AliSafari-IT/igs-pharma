import { createHmac, randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { type BrowserContext, type Page, expect, test } from "@playwright/test";
import postgres from "postgres";

import { smokeDatabaseUrl, smokeEnv } from "../smoke-env";

/**
 * igs-pharma#95: staff session limits and the fresh passkey check, against the production build.
 * The server refuses a session 30 minutes after its last activity and 8 hours after sign-in (no
 * browser timer involved); background requests never keep one alive; an idle tab clears itself;
 * and a role change asks for a passkey, which proves who is acting WITHOUT starting a new session
 * (so the 8-hour clock stays where it was). Needs SMOKE_DATABASE_URL (a migrated database).
 */
test.skip(!smokeDatabaseUrl, "set SMOKE_DATABASE_URL to a migrated database to run");

const PLATFORM = "http://localhost:3001";
const tag = randomUUID().slice(0, 8);

let sql: postgres.Sql;
const cleanup: string[] = [];

/** Better Auth's signed session cookie: `<token>.<base64 HMAC-SHA256>`, URI-encoded (better-call). */
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

async function staffUser(name: string, role: string, passkey = true) {
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO identity.users (id, name, email, email_verified, kind)
    VALUES (gen_random_uuid(), ${name}, ${`${randomUUID()}@example.test`}, true, 'staff')
    RETURNING id`;
  const id = (user as { id: string }).id;
  cleanup.push(id);
  await sql`
    INSERT INTO identity.user_roles (id, user_id, role_key, location_id)
    VALUES (gen_random_uuid(), ${id}, ${role}, NULL)`;
  if (passkey) {
    await sql`
      INSERT INTO identity.passkeys (id, user_id, public_key, credential_id, counter, device_type, backed_up)
      VALUES (gen_random_uuid(), ${id}, 'pk', ${randomUUID()}, 0, 'singleDevice', false)`;
  }
  return id;
}

/** A verified session for `userId`, signed in `signedInAgo` ago, last active `activeAgo` ago (SQL intervals). */
async function session(userId: string, signedInAgo = "1 minute", activeAgo: string | null = null) {
  const token = randomUUID();
  await sql`
    INSERT INTO identity.sessions (id, user_id, token, expires_at, mfa_verified_at, passkey_checked_at, created_at, last_activity_at)
    VALUES (gen_random_uuid(), ${userId}, ${token}, now() + interval '8 hours', now(), now(),
      now() - ${signedInAgo}::interval,
      ${activeAgo === null ? null : sql`now() - ${activeAgo}::interval`})`;
  return token;
}

async function signIn(context: BrowserContext, token: string) {
  await context.addCookies([
    { name: "better-auth.session_token", value: signed(token), url: PLATFORM },
  ]);
}

const sessionRow = async (token: string) => {
  const [row] = await sql<{ id: string; created_at: Date; last_activity_at: Date | null }[]>`
    SELECT id, created_at, last_activity_at FROM identity.sessions WHERE token = ${token}`;
  return row;
};

test.beforeAll(() => {
  sql = postgres(smokeDatabaseUrl as string, { max: 1, ssl: "require", onnotice: () => {} });
});

test.afterAll(async () => {
  for (const id of cleanup) {
    await sql`DELETE FROM audit.events WHERE entity_id = ${id}`.catch(() => {});
    await sql`DELETE FROM identity.users WHERE id = ${id}`;
  }
  await sql?.end({ timeout: 5 });
});

test.describe.configure({ mode: "serial" });

test("30 minutes without activity: refused by the server, sent to sign in with the reason", async ({
  page,
  context,
}) => {
  const owner = await staffUser(`Idle Owner ${tag}`, "owner");
  const token = await session(owner, "2 hours", "31 minutes");
  await signIn(context, token);
  await page.goto(`${PLATFORM}/staff`);
  await expect(page).toHaveURL(`${PLATFORM}/sign-in?reason=idle`);
  await expect(page.getByText("Signed out after 30 minutes without activity")).toBeVisible();
  expect(await sessionRow(token)).toBeUndefined();
  await expectAxeClean(page);
  // the same cookie no longer works anywhere
  await page.goto(`${PLATFORM}/products`);
  await expect(page).toHaveURL(`${PLATFORM}/sign-in`);
});

test("8 hours after sign-in: refused however active, sent to sign in with the reason", async ({
  page,
  context,
}) => {
  const owner = await staffUser(`Old Owner ${tag}`, "owner");
  const token = await session(owner, "8 hours 1 minute", "1 minute");
  await signIn(context, token);
  await page.goto(`${PLATFORM}/products`);
  await expect(page).toHaveURL(`${PLATFORM}/sign-in?reason=expired`);
  await expect(page.getByText("Signed out after 8 hours")).toBeVisible();
  expect(await sessionRow(token)).toBeUndefined();
});

test("background requests never keep a session alive; a page the person opens does", async ({
  page,
  context,
}) => {
  const owner = await staffUser(`Polling Owner ${tag}`, "owner");
  const token = await session(owner, "2 hours", "25 minutes");
  await signIn(context, token);
  const before = (await sessionRow(token))?.last_activity_at?.getTime();

  // the browser's own session check, a prefetch and a plain script request: none is activity
  await context.request.get(`${PLATFORM}/api/auth/get-session`);
  await context.request.get(`${PLATFORM}/staff`, { headers: { purpose: "prefetch" } });
  await context.request.get(`${PLATFORM}/staff`);
  expect((await sessionRow(token))?.last_activity_at?.getTime()).toBe(before);

  await page.goto(`${PLATFORM}/staff`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Staff", level: 1 })).toBeVisible();
  const after = (await sessionRow(token))?.last_activity_at?.getTime() ?? 0;
  expect(after).toBeGreaterThan(before ?? 0);
});

test("two workstations of one person: activity on one does not extend the other", async ({
  browser,
}) => {
  const owner = await staffUser(`Two PCs ${tag}`, "owner");
  const counter = await session(owner, "2 hours", "31 minutes");
  const office = await session(owner, "2 hours", "5 minutes");
  const officeContext = await browser.newContext();
  await signIn(officeContext, office);
  const officePage = await officeContext.newPage();
  await officePage.goto(`${PLATFORM}/staff`, { waitUntil: "networkidle" });
  await expect(officePage.getByRole("heading", { name: "Staff", level: 1 })).toBeVisible();
  await officeContext.close();

  const counterContext = await browser.newContext();
  await signIn(counterContext, counter);
  const counterPage = await counterContext.newPage();
  await counterPage.goto(`${PLATFORM}/staff`);
  await expect(counterPage).toHaveURL(`${PLATFORM}/sign-in?reason=idle`);
  await counterContext.close();
});

test("an idle tab clears its content and offers to sign in again", async ({ page, context }) => {
  const owner = await staffUser(`Tab Owner ${tag}`, "owner");
  const token = await session(owner, "1 minute");
  await signIn(context, token);
  await page.clock.install();
  await page.goto(`${PLATFORM}/staff`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Staff", level: 1 })).toBeVisible();
  await expect(page.locator("#main").getByText(`Tab Owner ${tag}`)).toBeVisible();

  await page.clock.fastForward("31:00");
  const prompt = page.getByTestId("idle-prompt");
  await expect(prompt).toBeVisible();
  await expect(prompt.getByText("No activity for 30 minutes")).toBeVisible();
  // no staff data stays on the screen (Next.js's own inline data scripts are not the screen)
  await expect(page.getByRole("heading", { name: "Staff", level: 1 })).toHaveCount(0);
  await expect(page.locator("#main").getByText(`Tab Owner ${tag}`)).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(`Tab Owner ${tag}`);
  await expectAxeClean(page);

  await prompt.getByRole("button", { name: "Sign in again" }).click();
  await expect(page).toHaveURL(`${PLATFORM}/sign-in?reason=idle`);
});

test("work in another tab keeps a tab from clearing itself, and a tab does not sign the person out (#100)", async ({
  browser,
}) => {
  const owner = await staffUser(`Two Tabs ${tag}`, "owner");
  const token = await session(owner, "1 minute");
  const context = await browser.newContext();
  await signIn(context, token);
  const quiet = await context.newPage();
  const busy = await context.newPage();
  await context.clock.install(); // one clock for the whole browser context, shared by both tabs
  await quiet.goto(`${PLATFORM}/staff`, { waitUntil: "networkidle" });
  await busy.goto(`${PLATFORM}/staff`, { waitUntil: "networkidle" });

  // 25 minutes in, the person types in the busy tab; at 35 minutes the quiet tab must not have cleared
  await context.clock.fastForward("25:00");
  await busy.keyboard.press("Shift");
  await context.clock.fastForward("10:00");
  await expect(quiet.getByTestId("idle-prompt")).toHaveCount(0);
  await expect(quiet.getByText(`Two Tabs ${tag}`)).toBeVisible();

  // nobody types for 30 more minutes: both tabs clear, and no tab signed the session out
  await context.clock.fastForward("21:00");
  await expect(quiet.getByTestId("idle-prompt")).toBeVisible();
  await expect(busy.getByTestId("idle-prompt")).toBeVisible();
  const [row] = await sql<
    { id: string }[]
  >`SELECT id FROM identity.sessions WHERE token = ${token}`;
  expect(row).toBeDefined();
  await context.close();
});

test("a tab that was asleep clears the moment it wakes, not 30 minutes later (#100)", async ({
  page,
  context,
}) => {
  const owner = await staffUser(`Sleeper ${tag}`, "owner");
  const token = await session(owner, "1 minute");
  await signIn(context, token);
  await page.clock.install();
  await page.goto(`${PLATFORM}/staff`, { waitUntil: "networkidle" });
  await expect(page.getByText(`Sleeper ${tag}`)).toBeVisible();

  // the laptop sleeps for an hour: the clock jumps, no timer ran
  await page.clock.setSystemTime(new Date(Date.now() + 61 * 60 * 1000));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByTestId("idle-prompt")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(`Sleeper ${tag}`);
});

test("a hidden tab that becomes visible again clears at once: visibilitychange (#110)", async ({
  page,
  context,
}) => {
  const owner = await staffUser(`Hidden ${tag}`, "owner");
  const token = await session(owner, "1 minute");
  await signIn(context, token);
  await page.clock.install();
  await page.goto(`${PLATFORM}/staff`, { waitUntil: "networkidle" });
  await expect(page.getByText(`Hidden ${tag}`)).toBeVisible();

  await page.clock.setSystemTime(new Date(Date.now() + 61 * 60 * 1000));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByTestId("idle-prompt")).toBeVisible();
});

// ── the fresh passkey check, with a real WebAuthn ceremony ─────────────────────────────────────

async function virtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

test("a role change asks for the passkey, then applies once, in a new session that keeps the 8-hour clock", async ({
  page,
}) => {
  const owner = await staffUser(`Fresh Owner ${tag}`, "owner", false);
  const target = await staffUser(`Role Target ${tag}`, "pharmacy_assistant");

  // the owner enrols a real passkey on a session the enrolment link started (inserted directly:
  // /enrolment/redeem is rate limited to 5 a minute, and the other specs use it too)
  const token = randomUUID();
  await sql`
    INSERT INTO identity.sessions (id, user_id, token, expires_at, enrolment_at)
    VALUES (gen_random_uuid(), ${owner}, ${token}, now() + interval '8 hours', now())`;
  await virtualAuthenticator(page);
  await signIn(page.context(), token);
  await page.goto(`${PLATFORM}/setup`);
  await page.getByRole("button", { name: "Add a passkey" }).click();
  await expect(page).toHaveURL(`${PLATFORM}/account`);

  // that session proved the passkey 20 minutes ago: verified, but not fresh, and signed in 3 hours ago
  await sql`
    UPDATE identity.sessions
    SET mfa_verified_at = now() - interval '20 minutes',
      passkey_checked_at = now() - interval '20 minutes',
      created_at = now() - interval '3 hours', last_activity_at = now()
    WHERE user_id = ${owner}`;
  const [{ id: sessionId, created_at: signedInAt } = { id: "", created_at: new Date(0) }] =
    await sql<{ id: string; created_at: Date }[]>`
      SELECT id, created_at FROM identity.sessions WHERE user_id = ${owner}`;

  await page.goto(`${PLATFORM}/staff`, { waitUntil: "networkidle" });
  const row = page.getByRole("row", { name: new RegExp(`Role Target ${tag}`) });
  await row.getByRole("button", { name: "Access" }).click();
  const dialog = page.getByRole("dialog", { name: `Access of Role Target ${tag}` });
  await dialog.getByLabel("Role").selectOption("content_editor");
  await dialog.getByRole("button", { name: "Grant role" }).click();
  await expect(dialog.getByText("Confirm it's you first")).toBeVisible();
  const held = async () =>
    (
      await sql<{ role_key: string }[]>`
        SELECT role_key FROM identity.user_roles WHERE user_id = ${target} ORDER BY role_key`
    ).map((r) => r.role_key);
  expect(await held()).toEqual(["pharmacy_assistant"]); // nothing changed yet

  await dialog.getByRole("button", { name: "Confirm with your passkey" }).click();
  await expect.poll(held).toEqual(["content_editor", "pharmacy_assistant"]);

  // the passkey check moved the browser to a NEW session (new token) that keeps the 8-hour clock
  const sessions = await sql<{ id: string; created_at: Date; fresh: boolean }[]>`
    SELECT id, created_at, passkey_checked_at > now() - interval '1 minute' AS fresh
    FROM identity.sessions WHERE user_id = ${owner}`;
  expect(sessions).toHaveLength(1);
  expect(sessions[0]?.id).not.toBe(sessionId);
  expect(sessions[0]?.created_at.getTime()).toBe(signedInAt.getTime());
  expect(sessions[0]?.fresh).toBe(true);

  const audit = await sql<{ action: string; actor_id: string }[]>`
    SELECT action, actor_id FROM audit.events WHERE entity_id = ${target} ORDER BY seq`;
  expect(audit).toEqual([{ action: "identity.role.granted", actor_id: owner }]);
});
