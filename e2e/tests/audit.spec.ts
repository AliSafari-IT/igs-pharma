import { createHmac, randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { type BrowserContext, type Page, expect, test } from "@playwright/test";
import postgres from "postgres";

import { smokeDatabaseUrl, smokeEnv } from "../smoke-env";

/**
 * igs-pharma#220: the back-office audit trail against the production build. A pharmacist-titular is
 * refused the early-access page (which leaves a `kernel.access.denied` entry, #210); the owner finds
 * that refusal with "Refused actions only" and sees who it was. The titular gets no Audit trail link
 * and the page refuses them. Needs SMOKE_DATABASE_URL (a migrated database).
 */
test.skip(!smokeDatabaseUrl, "set SMOKE_DATABASE_URL to a migrated database to run");

const PLATFORM = "http://localhost:3001";

let sql: postgres.Sql;
const tag = randomUUID().slice(0, 8);
const userIds: string[] = [];

const signed = (value: string) =>
  encodeURIComponent(
    `${value}.${createHmac("sha256", smokeEnv.AUTH_SECRET).update(value).digest("base64")}`,
  );

async function staff(name: string, role: string): Promise<{ id: string; token: string }> {
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
    VALUES (gen_random_uuid(), ${id}, ${token}, now() + interval '1 hour', now(), now())`;
  return { id, token };
}

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

test.beforeAll(() => {
  sql = postgres(smokeDatabaseUrl as string, { max: 1, ssl: "require", onnotice: () => {} });
});

test.afterAll(async () => {
  for (const id of userIds) {
    await sql`DELETE FROM identity.users WHERE id = ${id}`.catch(() => {});
  }
  await sql?.end({ timeout: 5 });
});

test.describe.configure({ mode: "serial" });

test("the owner finds a refused action and who it was; the titular sees nothing", async ({
  browser,
}) => {
  const titularName = `Audit Titular ${tag}`;
  const titular = await staff(titularName, "pharmacist_titular");
  const owner = await staff(`Audit Owner ${tag}`, "owner");

  // the titular is refused the early-access page: a kernel.access.denied entry
  const asTitular = await browser.newContext();
  await signIn(asTitular, titular.token);
  const tPage = await asTitular.newPage();
  await tPage.goto(`${PLATFORM}/early-access`, { waitUntil: "networkidle" });
  await expect(tPage.getByText("You can't see the early-access requests")).toBeVisible();
  // and has no audit trail: no link, and the page refuses them
  await expect(tPage.getByRole("link", { name: "Audit trail" })).toHaveCount(0);
  await tPage.goto(`${PLATFORM}/audit`, { waitUntil: "networkidle" });
  await expect(tPage.getByText("You can't see the audit trail")).toBeVisible();
  await expect(tPage.getByTestId("audit-table")).toHaveCount(0);
  await asTitular.close();

  // the owner searches the refused actions
  const asOwner = await browser.newContext();
  await signIn(asOwner, owner.token);
  const page = await asOwner.newPage();
  await page.goto(`${PLATFORM}/`, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Audit trail" }).click();
  await expect(page).toHaveURL(/\/audit$/);
  await page.getByTestId("audit-refused").check();
  await page.getByLabel("Who").selectOption({ label: titularName });
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/refused=1/);
  const rows = page.getByTestId("audit-table").getByRole("row").filter({ hasText: titularName });
  // both refusals: the early-access page, and the audit trail itself
  const earlyAccess = rows.filter({ hasText: "identity.early_access.list" });
  await expect(earlyAccess).toHaveCount(1);
  await expect(earlyAccess).toContainText("kernel.access.denied");
  await expect(earlyAccess).toContainText("kernel.forbidden");
  await expect(rows.filter({ hasText: "audit.events.list" })).toHaveCount(1);
  await expectAxeClean(page);
  await asOwner.close();
});
