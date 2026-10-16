import { createHmac, randomInt, randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { type BrowserContext, type Page, expect, test } from "@playwright/test";
import postgres from "postgres";

import { smokeDatabaseUrl, smokeEnv } from "../smoke-env";

/**
 * igs-pharma#115 PR A: the back-office shell and dashboard against the production build. A signed-in
 * owner sees every nav group and every tile; a content editor sees only what the role allows; the
 * menu works on a tablet and a phone; sign out ends the session. Needs SMOKE_DATABASE_URL.
 */
test.skip(!smokeDatabaseUrl, "set SMOKE_DATABASE_URL to a migrated database to run");

const PLATFORM = "http://localhost:3001";

let sql: postgres.Sql;
const userIds: string[] = [];
let ownerToken: string;
let editorToken: string;
let productId: string | undefined;

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

test.beforeAll(async () => {
  sql = postgres(smokeDatabaseUrl as string, { max: 1, ssl: "require", onnotice: () => {} });
  ownerToken = await staffMember("Olivia Owner", "owner");
  editorToken = await staffMember("Eddie Editor", "content_editor");
});

test.afterAll(async () => {
  if (productId) await sql`DELETE FROM catalog.products WHERE id = ${productId}`;
  for (const id of userIds) await sql`DELETE FROM identity.users WHERE id = ${id}`;
  await sql?.end({ timeout: 5 });
});

test.describe.configure({ mode: "serial" });

test("signed out: the home is a plain page with a way in, not the dashboard", async ({ page }) => {
  await page.goto(`${PLATFORM}/`, { waitUntil: "networkidle" });
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(page.getByTestId("tile-products")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Back-office" })).toHaveCount(0);
});

test("owner: the frame, every nav group and every tile", async ({ page, context }) => {
  await signIn(context, ownerToken);
  await page.goto(`${PLATFORM}/`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  await expect(page.getByTestId("staff-name")).toHaveText("Olivia Owner");
  await expect(page.getByTestId("staff-role")).toHaveText("Owner");
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

  const nav = page.getByRole("navigation", { name: "Back-office" });
  for (const group of ["Catalogue", "Stock", "Privacy", "Staff", "Account"]) {
    await expect(nav.getByRole("heading", { name: group, level: 2 })).toBeVisible();
  }
  for (const link of [
    "Products",
    "Categories",
    "Stock",
    "Data requests",
    "Consents",
    "Staff",
    "Your account",
  ]) {
    await expect(nav.getByRole("link", { name: link, exact: true })).toBeVisible();
  }
  for (const tile of ["products", "stock", "reservations", "requests"]) {
    await expect(page.getByTestId(`tile-${tile}`)).toBeVisible();
  }
  await expect(page.getByTestId("tile-products").getByText("Awaiting approval")).toBeVisible();
  await expect(page.getByTestId("tile-stock").getByText("Out of stock")).toBeVisible();
  await expect(page.getByTestId("tile-stock").getByText("Short for orders")).toBeVisible();
  // #112 V1 item 1: the "Needs attention" panel under the tiles, a list or its calm empty line
  const attention = page.getByTestId("needs-attention");
  await expect(attention.getByRole("heading", { name: "Needs attention", level: 2 })).toBeVisible();
  await expect(attention).toContainText(
    /short for orders|overdue|out of stock|awaiting|Nothing needs attention/,
  );
  await expect(page.getByTestId("tile-reservations")).toContainText(
    /Orders and checkout holds|No active reservations/,
  );
  await expect(page.getByTestId("tile-requests")).toContainText(/Open|No open data requests/);
  await expectAxeClean(page);

  // the current page is marked, and the tile links lead to the pages
  await page.getByTestId("tile-products").getByRole("link", { name: "Open products" }).click();
  await expect(page).toHaveURL(`${PLATFORM}/products`);
  await expect(
    page
      .getByRole("navigation", { name: "Back-office" })
      .getByRole("link", { name: "Products", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Products", level: 1 })).toBeVisible();
  // The shared page header (#112 V1): one h1, in the header, with the primary action beside it.
  const header = page.getByRole("main").locator("header").first();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(header.getByRole("heading", { name: "Products", level: 1 })).toBeVisible();
  await expect(header.getByRole("link", { name: "New product" })).toBeVisible();

  // Form and detail pages share it too (#112 V1 item 2 part 2), back link inside the header.
  await header.getByRole("link", { name: "New product" }).click();
  await expect(page).toHaveURL(`${PLATFORM}/products/new`);
  const formHeader = page.getByRole("main").locator("header").first();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(formHeader.getByRole("heading", { name: "New product", level: 1 })).toBeVisible();
  await expect(formHeader.getByRole("link", { name: "Back to products" })).toHaveAttribute(
    "href",
    "/products",
  );
});

test("the products tile counts medicines whose text no pharmacist approved", async ({
  page,
  context,
}) => {
  await signIn(context, ownerToken);
  const awaiting = async () => {
    await page.goto(`${PLATFORM}/`, { waitUntil: "networkidle" });
    const text = await page
      .getByTestId("tile-products")
      .locator("div", { hasText: "Awaiting approval" })
      .last()
      .locator("dd")
      .innerText();
    return Number(text);
  };
  const before = await awaiting();
  const cnk = `97${String(randomInt(0, 100_000)).padStart(5, "0")}`;
  const [product] = await sql<{ id: string }[]>`
    INSERT INTO catalog.products (id, cnk, product_type, legal_status, vat_class, status)
    VALUES (gen_random_uuid(), ${cnk}, 'otc_medicine', 'otc', 'BE_6', 'draft')
    RETURNING id`;
  productId = (product as { id: string }).id;
  await sql`
    INSERT INTO catalog.product_content (product_id, locale, name, source)
    VALUES (${productId}, 'nl', 'Demo E2E dashboard', 'manual'), (${productId}, 'fr', 'Démo E2E', 'manual')`;
  expect(await awaiting()).toBe(before + 1);
  // the panel lists it too, linked to the products page
  await expect(page.getByTestId("attention-awaiting").getByRole("link")).toHaveAttribute(
    "href",
    "/products",
  );
  // a pharmacist approves both texts: it no longer waits
  await sql`
    UPDATE catalog.product_content SET approved_by = ${userIds[0] as string}, approved_at = now()
    WHERE product_id = ${productId}`;
  expect(await awaiting()).toBe(before);
});

test("a content editor sees only the catalogue tile and the catalogue and account nav", async ({
  page,
  context,
}) => {
  await signIn(context, editorToken);
  await page.goto(`${PLATFORM}/`, { waitUntil: "networkidle" });
  await expect(page.getByTestId("staff-name")).toHaveText("Eddie Editor");
  await expect(page.getByTestId("staff-role")).toHaveText("Content editor");
  await expect(page.getByTestId("tile-products")).toBeVisible();
  await expect(page.getByTestId("tile-stock")).toHaveCount(0);
  await expect(page.getByTestId("tile-reservations")).toHaveCount(0);
  await expect(page.getByTestId("tile-requests")).toHaveCount(0);
  // the panel reads only the products tile: no stock or data-request lines
  await expect(page.getByTestId("needs-attention")).toBeVisible();
  for (const line of ["short", "overdue", "out"]) {
    await expect(page.getByTestId(`attention-${line}`)).toHaveCount(0);
  }
  const nav = page.getByRole("navigation", { name: "Back-office" });
  await expect(nav.getByRole("link", { name: "Products", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Your account", exact: true })).toBeVisible();
  for (const hidden of ["Stock", "Data requests", "Consents", "Staff"]) {
    await expect(nav.getByRole("link", { name: hidden, exact: true })).toHaveCount(0);
  }
  await expect(nav.getByRole("heading", { name: "Stock", level: 2 })).toHaveCount(0);
  await expectAxeClean(page);
});

test("sign out ends the session and goes to the sign-in page", async ({ page, context }) => {
  const token = await staffMember("Sally Signout", "owner");
  await signIn(context, token);
  await page.goto(`${PLATFORM}/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(`${PLATFORM}/sign-in`);
  // #112 V1: the sign-in page is the branded card: wordmark, then one h1
  await expect(page.getByTestId("auth-wordmark")).toContainText("IGS-Pharma");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in to the back-office");
  // the session is gone: a protected page sends us back to sign in
  await page.goto(`${PLATFORM}/stock`);
  await expect(page).toHaveURL(/\/sign-in$/);
});

for (const [label, width, height] of [
  ["a tablet, 768 px", 768, 900],
  ["a phone, 360 px", 360, 740],
] as const) {
  test.describe(label, () => {
    test.use({ viewport: { width, height } });

    test("no sideways scrolling, axe is clean and the menu is reachable", async ({
      page,
      context,
    }) => {
      await signIn(context, ownerToken);
      for (const path of ["/", "/products", "/stock"]) {
        await page.goto(`${PLATFORM}${path}`, { waitUntil: "networkidle" });
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${path} at ${width}px`).toBeLessThanOrEqual(0);
      }
      await page.goto(`${PLATFORM}/`, { waitUntil: "networkidle" });
      await expectAxeClean(page);
      if (width < 1024) {
        // the sidebar is a disclosure below 1024 px: it opens by keyboard and its links are big enough
        await page.getByText("Menu", { exact: true }).focus();
        await page.keyboard.press("Enter");
        const link = page.getByRole("link", { name: "Stock", exact: true });
        await expect(link).toBeVisible();
        expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      } else {
        await expect(
          page
            .getByRole("navigation", { name: "Back-office" })
            .getByRole("link", { name: "Stock", exact: true }),
        ).toBeVisible();
      }
    });
  });
}
