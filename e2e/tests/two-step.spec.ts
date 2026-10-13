import { createHash, randomBytes, randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";
import postgres from "postgres";

import { smokeDatabaseUrl } from "../smoke-env";

/**
 * 36b: staff 2-step login against the production build, with a real WebAuthn ceremony (Chromium's
 * virtual authenticator, user verification on). An enrolment link, as the bootstrap CLI prints it,
 * signs the person in WITHOUT a verified second factor: every back-office page sends them to
 * "Set up 2-step login" until they add a passkey; afterwards the passkey alone signs them in.
 * Needs SMOKE_DATABASE_URL (a migrated database); skipped without it.
 */
test.skip(!smokeDatabaseUrl, "set SMOKE_DATABASE_URL to a migrated database to run");

const PLATFORM = "http://localhost:3001";

let sql: postgres.Sql;
let userId: string;

/** An enrolment link for `userId`, stored the way `bootstrapStaff` stores it (SHA-256 only). */
async function enrolmentLink(id: string) {
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  await sql`
    INSERT INTO identity.verifications (id, identifier, value, expires_at)
    VALUES (gen_random_uuid(), ${`staff-enrolment:${hash}`}, ${id}, now() + interval '15 minutes')`;
  return `${PLATFORM}/enrol#token=${token}`;
}

/** Chromium's virtual platform authenticator: resident keys, user verification succeeds. */
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

async function expectAxeClean(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

test.beforeAll(async () => {
  sql = postgres(smokeDatabaseUrl as string, { max: 1, ssl: "require", onnotice: () => {} });
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO identity.users (id, name, email, kind)
    VALUES (gen_random_uuid(), 'Smoke Owner', ${`${randomUUID()}@example.test`}, 'staff')
    RETURNING id`;
  userId = (user as { id: string }).id;
  await sql`
    INSERT INTO identity.user_roles (id, user_id, role_key, location_id)
    VALUES (gen_random_uuid(), ${userId}, 'pharmacy_assistant', NULL)`;
});

test.afterAll(async () => {
  if (userId) {
    await sql`DELETE FROM audit.events WHERE entity_id = ${userId}`.catch(() => {});
    await sql`DELETE FROM identity.users WHERE id = ${userId}`;
  }
  await sql?.end({ timeout: 5 });
});

test.describe.configure({ mode: "serial" });

test("an enrolment link leads to 'Set up 2-step login', not the back-office; axe clean", async ({
  page,
}) => {
  await page.goto(await enrolmentLink(userId));
  await expect(page).toHaveURL(`${PLATFORM}/enrol`); // the token left the address bar
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(`${PLATFORM}/setup`);
  await expect(page.getByRole("heading", { level: 1, name: "Set up 2-step login" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add a passkey" })).toBeVisible();
  // igs-pharma#90: staff sign in with a passkey only, so an authenticator app is never the first factor
  await expect(page.getByRole("button", { name: "Set up an authenticator app" })).toHaveCount(0);
  await expectAxeClean(page);

  await page.goto(`${PLATFORM}/account`);
  await expect(page).toHaveURL(`${PLATFORM}/setup`);
});

test("a used link is refused", async ({ page }) => {
  const link = await enrolmentLink(userId);
  await sql`DELETE FROM identity.verifications WHERE value = ${userId}`;
  await page.goto(link);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("This link is invalid, used or expired")).toBeVisible();
});

test("adding a passkey turns 2-step login on, audited; the passkey alone signs in again", async ({
  page,
}) => {
  await virtualAuthenticator(page);
  await page.goto(await enrolmentLink(userId));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(`${PLATFORM}/setup`);

  await page.getByRole("button", { name: "Add a passkey" }).click();
  await expect(page).toHaveURL(`${PLATFORM}/account`);
  await expect(page.getByText("Smoke Owner")).toBeVisible();
  await expect(page.locator("dd").filter({ hasText: /^1 passkey$/ })).toBeVisible();

  const audit = await sql<{ action: string; data: unknown }[]>`
    SELECT action, data FROM audit.events WHERE entity_id = ${userId} ORDER BY seq`;
  expect(audit).toEqual([{ action: "identity.mfa.enrolled", data: { userId, method: "passkey" } }]);

  // signed out: the passkey (user verification on) is the whole sign-in
  await page.context().clearCookies();
  await page.goto(`${PLATFORM}/account`);
  await expect(page.getByText("You are not signed in")).toBeVisible();
  await page.goto(`${PLATFORM}/sign-in`);
  await expectAxeClean(page);
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(page).toHaveURL(`${PLATFORM}/account`);
  await expect(page.getByText("Smoke Owner")).toBeVisible();

  const [verified] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM identity.sessions
    WHERE user_id = ${userId} AND mfa_verified_at IS NOT NULL`;
  expect(verified?.n).toBeGreaterThanOrEqual(2);
});

test("with a passkey enrolled, a new link only asks to confirm with it", async ({ page }) => {
  await page.goto(await enrolmentLink(userId));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(`${PLATFORM}/setup`);
  await expect(page.getByRole("heading", { name: "Confirm it's you" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add a passkey" })).toHaveCount(0);
  await expectAxeClean(page);
});
