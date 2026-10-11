import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // next-intl's ESM build imports "next/server" without an extension, which Node's resolver
    // rejects; inlining lets Vite resolve it (the proxy test imports next-intl/middleware).
    server: { deps: { inline: ["next-intl"] } },
  },
});
