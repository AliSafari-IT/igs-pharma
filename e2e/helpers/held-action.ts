import type { Page, Request } from "@playwright/test";

/** Hold one real Server Action response after execution; never manufacture a success or retry it. */
export async function holdNextAction(page: Page) {
  const path = new URL(page.url()).pathname;
  let releaseResponse: () => void = () => {};
  let responseReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    responseReady = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let requests = 0;
  const count = (request: Request) => {
    if (
      new URL(request.url()).pathname === path &&
      request.method() === "POST" &&
      request.headers()["next-action"]
    )
      requests++;
  };
  page.on("request", count);
  await page.route(
    (url) => url.pathname === path,
    async (route) => {
      if (route.request().method() !== "POST" || !route.request().headers()["next-action"]) {
        await route.fallback();
        return;
      }
      const response = await route.fetch({ maxRedirects: 0 });
      responseReady();
      await gate;
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  return {
    ready,
    requests: () => requests,
    release: () => {
      releaseResponse();
      page.off("request", count);
    },
  };
}
