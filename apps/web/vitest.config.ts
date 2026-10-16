import { defineConfig } from "vitest/config";

export default defineConfig({
  // the loading skeleton test renders JSX (as in @igs/ui); tsconfig's "preserve" is for Next only
  esbuild: { jsx: "automatic" },
  test: {
    include: ["test/**/*.test.{ts,tsx}"],
    environment: "node",
    // next-intl's ESM build imports "next/server" without an extension, which Node's resolver
    // rejects; inlining lets Vite resolve it (the proxy test imports next-intl/middleware).
    server: { deps: { inline: ["next-intl"] } },
  },
});
