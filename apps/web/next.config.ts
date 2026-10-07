import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Validate env at build time — fail fast before a broken image is deployed
// getEnv() is called lazily; skip at build time if DATABASE_URL not available
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const config: NextConfig = {
  output: "standalone",

  // HTML responses get the full policy (CSP nonce, HSTS, …) from src/proxy.ts (T-011). This only
  // covers what the proxy matcher skips (_next/static, files with an extension).
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // off: prefetching leaks which links a visitor saw to DNS resolvers (health-related site)
          { key: "X-DNS-Prefetch-Control", value: "off" },
        ],
      },
    ];
  },

  images: {
    remotePatterns: [],
  },
};

export default withNextIntl(config);
