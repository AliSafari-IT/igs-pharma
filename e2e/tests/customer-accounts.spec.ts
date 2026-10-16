import { expect, test } from "@playwright/test";

/**
 * igs-pharma#115, PR B: the customer account pages are behind `NEXT_PUBLIC_FEATURE_CUSTOMER_ACCOUNTS`,
 * which the smoke run leaves off (its default). Proves that, switched off, every account page is the
 * plain localized 404, the header has no account link and the customer auth routes do not answer.
 * The pages themselves are covered by unit tests until staging turns the flag on.
 */
const WEB = "http://localhost:3000";
const PAGES = ["sign-up", "sign-in", "forgot-password", "reset-password", "verify-email"];

test("flag off: every account page is a 404", async ({ request }) => {
  for (const locale of ["nl", "fr", "de", "en"]) {
    for (const name of PAGES) {
      const response = await request.get(`${WEB}/${locale}/account/${name}`);
      expect(response.status(), `${locale}/${name}`).toBe(404);
    }
  }
  const signIn = await request.get(`${WEB}/nl/account/sign-in`);
  expect(await signIn.text()).toContain("Pagina niet gevonden");
});

test("flag off: no account link in the header, no customer auth routes", async ({
  page,
  request,
}) => {
  await page.goto(`${WEB}/nl`);
  await expect(page.getByTestId("header-pharmacy-link")).toBeVisible();
  await expect(page.getByTestId("header-account-link")).toHaveCount(0);
  const signUp = await request.post(`${WEB}/api/auth/sign-up/email`, {
    data: { email: "nobody@example.test", password: "a long enough password", name: "Nobody" },
  });
  expect(signUp.status()).toBe(404);
});
