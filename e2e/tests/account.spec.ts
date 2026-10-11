import { createHmac, randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { type BrowserContext, expect, test } from "@playwright/test";
import postgres from "postgres";

import { smokeDatabaseUrl, smokeEnv } from "../smoke-env";

/**
 * T-016 (36a): the read-only /account page with a real session, against the production build.
 * Needs SMOKE_DATABASE_URL (a migrated database); skipped without it. Proves that the page shows
 * the roles resolved from the database, that a revoked role is gone on the next request and that
 * a suspended user is signed out on the next request (no cookie cache, Q2/Q6).
 */
test.skip(!smokeDatabaseUrl, "set SMOKE_DATABASE_URL to a migrated database to run");

const ACCOUNT = "http://localhost:3001/account";

let sql: postgres.Sql;
let userId: string;
let token: string;

/** Better Auth's signed session cookie: `<token>.<base64 HMAC-SHA256>`, URI-encoded (better-call). */
const signed = (value: string) =>
  encodeURIComponent(
    `${value}.${createHmac("sha256", smokeEnv.AUTH_SECRET).update(value).digest("base64")}`,
  );

async function signIn(context: BrowserContext) {
  await context.addCookies([
    { name: "better-auth.session_token", value: signed(token), url: "http://localhost:3001" },
  ]);
}

test.beforeAll(async () => {
  sql = postgres(smokeDatabaseUrl as string, { max: 1, onnotice: () => {} });
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO identity.users (id, name, email, email_verified, kind)
    VALUES (gen_random_uuid(), 'Smoke Staff', ${`${randomUUID()}@example.test`}, true, 'staff')
    RETURNING id`;
  userId = (user as { id: string }).id;
  await sql`
    INSERT INTO identity.user_roles (id, user_id, role_key, location_id) VALUES
      (gen_random_uuid(), ${userId}, 'owner', NULL),
      (gen_random_uuid(), ${userId}, 'pharmacist', NULL)`;
  token = randomUUID();
  await sql`
    INSERT INTO identity.sessions (id, user_id, token, expires_at)
    VALUES (gen_random_uuid(), ${userId}, ${token}, now() + interval '1 hour')`;
});

test.afterAll(async () => {
  if (userId) await sql`DELETE FROM identity.users WHERE id = ${userId}`;
  await sql?.end({ timeout: 5 });
});

test.describe.configure({ mode: "serial" });

test("signed in: profile and DB-resolved roles, axe clean", async ({ page, context }) => {
  await signIn(context);
  await page.goto(ACCOUNT, { waitUntil: "networkidle" });

  await expect(page.getByText("Smoke Staff")).toBeVisible();
  await expect(page.locator("dd").filter({ hasText: /^staff$/ })).toBeVisible();
  await expect(page.locator("dd").filter({ hasText: /^active$/ })).toBeVisible();
  const rows = page.locator("tbody tr");
  await expect(rows).toHaveText([/owner\s*All locations/, /pharmacist\s*All locations/]);

  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});

test("a revoked role is gone on the next request", async ({ page, context }) => {
  await signIn(context);
  await sql`DELETE FROM identity.user_roles WHERE user_id = ${userId} AND role_key = 'owner'`;
  await page.goto(ACCOUNT, { waitUntil: "networkidle" });
  await expect(page.locator("tbody tr")).toHaveText([/pharmacist\s*All locations/]);
});

test("a suspended user is signed out on the next request", async ({ page, context }) => {
  await signIn(context);
  await sql`UPDATE identity.users SET status = 'suspended' WHERE id = ${userId}`;
  await page.goto(ACCOUNT, { waitUntil: "networkidle" });
  await expect(page.getByText("You are not signed in")).toBeVisible();
  await expect(page.getByText("Smoke Staff")).toHaveCount(0);
});
