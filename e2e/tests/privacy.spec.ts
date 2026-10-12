import { createHmac, randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { type BrowserContext, type Page, expect, test } from "@playwright/test";
import postgres from "postgres";

import { smokeDatabaseUrl, smokeEnv } from "../smoke-env";

/**
 * igs-pharma#58: back-office privacy against the production build. A signed-in owner (who proved a
 * second factor) logs an erasure request, moves it to in progress then completed, and sees the
 * timeline; a backdated request shows as Overdue; a consent change is recorded and shown.
 * Needs SMOKE_DATABASE_URL (a migrated database).
 */
test.skip(!smokeDatabaseUrl, "set SMOKE_DATABASE_URL to a migrated database to run");

const PLATFORM = "http://localhost:3001";

let sql: postgres.Sql;
let userId: string;
let token: string;
let overdueId: string;
const tag = randomUUID().slice(0, 8);
const subject = `e2e.${tag}@example.invalid`;
const overdueSubject = `e2e.overdue.${tag}@example.invalid`;

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

test.beforeAll(async () => {
  // the same TLS the production build insists on (see smoke-env.ts)
  sql = postgres(smokeDatabaseUrl as string, { max: 1, ssl: "require", onnotice: () => {} });
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO identity.users (id, name, email, email_verified, kind)
    VALUES (gen_random_uuid(), 'Privacy Owner', ${`${randomUUID()}@example.test`}, true, 'staff')
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
  // a request received 35 days ago, still open: past its 30-day deadline
  const [request] = await sql<{ id: string }[]>`
    INSERT INTO privacy.dsr_requests
      (id, subject_ref, type, channel, received_at, due_at, status, created_by)
    VALUES (gen_random_uuid(), ${overdueSubject}, 'access', 'email',
      now() - interval '35 days', now() - interval '5 days', 'received', ${userId})
    RETURNING id`;
  overdueId = (request as { id: string }).id;
  await sql`
    INSERT INTO privacy.dsr_events (id, request_id, to_status, actor_type, actor_id)
    VALUES (gen_random_uuid(), ${overdueId}, 'received', 'user', ${userId})`;
});

test.afterAll(async () => {
  // privacy requests and their timelines are kept (append-only); they hold only fake addresses
  if (userId) {
    await sql`DELETE FROM identity.sessions WHERE user_id = ${userId}`;
    await sql`DELETE FROM identity.passkeys WHERE user_id = ${userId}`;
    await sql`DELETE FROM identity.user_roles WHERE user_id = ${userId}`;
  }
  await sql?.end({ timeout: 5 });
});

test.describe.configure({ mode: "serial" });

test("signed out: the data requests page sends you to sign in", async ({ page }) => {
  await page.goto(`${PLATFORM}/privacy/requests`);
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("owner: a backdated open request is overdue", async ({ page, context }) => {
  await signIn(context);
  await page.goto(`${PLATFORM}/privacy/requests`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Data requests", level: 1 })).toBeVisible();
  await expect(page.getByText("Overdue requests")).toBeVisible();
  await expectAxeClean(page);
  await page.goto(`${PLATFORM}/privacy/requests/${overdueId}`, { waitUntil: "networkidle" });
  await expect(page.getByText(overdueSubject)).toBeVisible();
  await expect(page.getByText("Overdue", { exact: true })).toBeVisible();
  await expect(page.getByText("5 days overdue")).toBeVisible();
});

test("owner: log an erasure request, move it to in progress, then completed", async ({
  page,
  context,
}) => {
  await signIn(context);
  await page.goto(`${PLATFORM}/privacy/requests/new`, { waitUntil: "networkidle" });
  await expectAxeClean(page);
  await page.getByLabel("Type of request").selectOption("erasure");
  await page.getByLabel("The person's e-mail address").fill("not an e-mail");
  await page.getByRole("button", { name: "Log request" }).click();
  await expect(page.getByText("Enter the person's e-mail address.").first()).toBeVisible();
  await page.getByLabel("The person's e-mail address").fill(subject.toUpperCase());
  await page.getByRole("button", { name: "Log request" }).click();

  await expect(page.getByRole("heading", { name: "Erasure request", level: 1 })).toBeVisible();
  await expect(page.getByText("Request logged", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(subject)).toBeVisible();
  await expect(page.getByText("Due in 30 days")).toBeVisible();
  await expectAxeClean(page);

  // rejecting needs a reason; then in progress, then completed
  await page.getByRole("button", { name: "Change status" }).click();
  let dialog = page.getByRole("dialog", { name: "Change status" });
  await dialog.getByLabel("New status").selectOption("rejected");
  await dialog.getByRole("button", { name: "Save status" }).click();
  await expect(dialog.getByText("Say why the request is rejected.")).toBeVisible();
  await dialog.getByLabel("New status").selectOption("in_progress");
  await dialog.getByRole("button", { name: "Save status" }).click();
  await expect(page.getByText("Status changed to in progress")).toBeVisible();

  await page.getByRole("button", { name: "Change status" }).click();
  dialog = page.getByRole("dialog", { name: "Change status" });
  await dialog.getByLabel("New status").selectOption("completed");
  await dialog.getByLabel("Note").fill("Account data erased");
  await dialog.getByRole("button", { name: "Save status" }).click();
  await expect(page.getByText("Status changed to completed")).toBeVisible();
  await expect(page.getByRole("button", { name: "Change status" })).toHaveCount(0);
  const timeline = page.getByRole("region", { name: "Timeline" });
  await expect(timeline.getByRole("listitem")).toHaveCount(3);
  await expect(timeline).toContainText("In progress → Completed");
  await expect(timeline).toContainText("Account data erased");
  await expectAxeClean(page);

  const [audit] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM audit.events
    WHERE actor_id = ${userId} AND action IN ('privacy.dsr.created', 'privacy.dsr.transitioned')`;
  expect(audit?.n).toBe(3);
  const [leak] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM audit.events
    WHERE actor_id = ${userId} AND data::text ILIKE ${`%${tag}%`}`;
  expect(leak?.n).toBe(0);
});

test("owner: record a consent given in the pharmacy, then see it", async ({ page, context }) => {
  await signIn(context);
  await page.goto(`${PLATFORM}/privacy/consents`, { waitUntil: "networkidle" });
  await page.getByLabel("The person's e-mail address").fill(subject);
  await page.getByRole("button", { name: "Look up" }).click();
  await expect(page.getByText("Never asked").first()).toBeVisible();
  await expectAxeClean(page);

  await page.getByLabel("Purpose").selectOption("marketing_email");
  await page.getByLabel("Given or withdrawn").selectOption("true");
  await page.getByLabel("Told us").selectOption("in_store");
  await page.getByRole("button", { name: "Record change" }).click();
  await expect(page.getByText("Consent change recorded")).toBeVisible();
  const current = page.getByRole("region", { name: /Current consents/ });
  await expect(current.getByText("Given")).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page).not.toHaveURL(new RegExp(tag));
  await expectAxeClean(page);
});
